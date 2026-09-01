# Encrypted TeslaCam Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play Tesla's eCryptfs-encrypted Dashcam/Sentry clips by fetching per-file keys (FEKs) from the Tesla account (OAuth popup + paste-URL login) and decrypting on the fly in the backend.

**Architecture:** Backend parses the 8 KiB eCryptfs header to detect encrypted clips and extract wrapped-key material. FEKs are fetched from `https://dashcam.tesla.com/api/1/decrypt/batch` (batches ≤30) and cached in `.teslacam_keys.json` next to the footage. `MediaController` streams decrypted plaintext (AES-128-CBC per 4096-byte page, deterministic IVs) with manual Range handling. Frontend adds a Tesla login dialog, key-fetch orchestration, and lock icons; the `<video src>` flow is unchanged.

**Tech Stack:** Kotlin 2.3 / Spring Boot 4 (JDK 25 toolchain), `RestClient` (already in starter-web, no new deps), JUnit 5 + MockK + MockRestServiceServer; React 18 + TS + MUI, vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-tesla-encrypted-playback-design.md`

## Global Constraints

- Backend: Kotlin 2.3, Spring Boot 4.0.0, Java 25 toolchain (`backend/build.gradle.kts`), package root `dev.teslacam`. No new Gradle dependencies (crypto via `javax.crypto`/`MessageDigest`; HTTP via `RestClient`).
- Frontend: React 18 + TypeScript + Vite + MUI; tests in vitest. No new runtime deps.
- Cipher (exact, per reference `ecryptfs.py`): AES-128-CBC **NoPadding**; 4096-byte pages from file offset 8192; root IV = `MD5(FEK)`; page IV = first 16 bytes of `MD5(rootIv(16) || ascii(pageNo) || NUL padding to 32 bytes)`; final output truncated to the u64 plaintext size at header offset 0.
- Header validation: plaintext size (u64 BE @0) ≤ `fileLength − 8192`; `u32@8 XOR u32@12 == 0x3C81B7F5`; `u32@16 == 0x03000002`; `u32@20 == 4096`; `u16@24 == 2`; file length ≥ 8192 and multiple of 4096.
- Wrapped-key layout (BE) from offset 4096: `key_id` u32 | `public_key` 65 B (byte 0 = `0x04`) | `vin` 17 ASCII bytes (byte 0 ≠ `0x00`) | `timestamp` u64 | `wrapped_key` 44 B; ends at offset 4234.
- Tesla endpoints: authorize `https://auth.tesla.com/oauth2/v3/authorize`; token `https://auth.tesla.com/oauth2/v3/token` (form POST); batch `https://dashcam.tesla.com/api/1/decrypt/batch` (≤30 items per batch). `client_id=dashcam`, `redirect_uri=https://dashcam.tesla.com/callback`, scopes `openid profile email offline_access`.
- Batch item JSON (snake_case): `{id, vin, key_id, timestamp, wrapped_key, public_key}` (the two blobs base64). Accept all three response shapes: `{"results":[{"id","key"}]}`, `[{"id","key"}]`, `{"<id>":"<key>"}`; drop empty `key` values.
- FEK store: `.teslacam_keys.json` in `teslacam.root`; map `"<vin>:<key_id>:<timestamp>"` → base64 16-byte FEK; atomic write (temp + `ATOMIC_MOVE`); never log FEKs or tokens.
- Plain (unencrypted) media behavior must remain byte-identical: `MediaController`'s existing `PathResource` path stays untouched.
- Frontend localStorage: `tesla.tokens` = `{accessToken, refreshToken, expiresAt}`; `tesla.pkce` = `{verifier, state}`.
- PKCE verifier/challenge/state are minted by the backend (`GET /api/tesla/pkce`) so the UI does not depend on `crypto.subtle` (unavailable on non-HTTPS LAN origins).
- Commit messages conventional (`feat`/`test`/`chore`/`docs`), per repo history.
- Commands: backend tests `cd backend && ./gradlew test`; frontend tests `cd frontend && npm test -- --run`; frontend build `cd frontend && npm run build`.

---

### Task 1: Ecryptfs header reader + encryption detector

**Files:**
- Create: `backend/src/main/kotlin/dev/teslacam/encrypt/EcryptfsHeader.kt`
- Create: `backend/src/main/kotlin/dev/teslacam/encrypt/EncryptionDetector.kt`
- Create (test source set): `backend/src/test/kotlin/dev/teslacam/encrypt/TestClips.kt`
- Test: `backend/src/test/kotlin/dev/teslacam/encrypt/EcryptfsHeaderTest.kt`

**Interfaces:**
- Consumes: nothing (filesystem only).
- Produces:
  - `class EcryptfsHeader(plaintextSize: Long, keyId: Long, vin: String, timestamp: Long, publicKey: ByteArray, wrappedKey: ByteArray)` with computed `storeKey: String` = `"$vin:$keyId:$timestamp"`, `publicKeyB64: String`, `wrappedKeyB64: String`.
  - `object EcryptfsHeaderReader` with `fun read(path: Path): EcryptfsHeader?` (null = plain file or any validation failure), `const val HEADER_SIZE = 8192`, `const val PAGE_SIZE = 4096`.
  - `@Component class EncryptionDetector` with `fun headerFor(path: Path): EcryptfsHeader?` — cached by absolute path, invalidated when mtime+size change.

- [ ] **Step 1: Write the failing tests**

`backend/src/test/kotlin/dev/teslacam/encrypt/TestClips.kt` (shared synthetic-clip builder; later tasks import it):

```kotlin
package dev.teslacam.encrypt

import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Builds synthetic eCryptfs clips mirroring Tesla's format (see spec). */
object TestClips {
    const val HEADER_SIZE = 8192
    const val PAGE_SIZE = 4096
    const val MAGIC = 0x3C81B7F5L

    /** Deterministic 16-byte FEK for tests. */
    fun fek(): ByteArray = "0123456789abcdef".toByteArray(Charsets.US_ASCII)

    /** 65-byte uncompressed EC point blob (only byte 0 is validated: 0x04). */
    fun publicKeyBlob(): ByteArray = byteArrayOf(0x04) + ByteArray(64) { (it * 3 + 1).toByte() }

    /** 44-byte wrapped-key blob (contents opaque to our reader). */
    fun wrappedKeyBlob(): ByteArray = ByteArray(44) { (it + 7).toByte() }

    /** Byte-identical to production PageDecryptor.deriveIv (Task 2 round-trip proves it). */
    fun deriveIv(rootIv: ByteArray, page: Int): ByteArray {
        val buf = ByteArray(32)
        System.arraycopy(rootIv, 0, buf, 0, 16)
        val digits = page.toString().toByteArray(Charsets.US_ASCII)
        System.arraycopy(digits, 0, buf, 16, digits.size)
        return MessageDigest.getInstance("MD5").digest(buf).copyOf(16)
    }

    fun buildEncrypted(
        dir: Path, name: String, plaintext: ByteArray,
        keyId: Long = 7L, vin: String = "LRW3E7EK5MC000000",
        timestamp: Long = 1_700_000_000_000L, fek: ByteArray = fek(),
    ): Path {
        val pages = maxOf(1, (plaintext.size + PAGE_SIZE - 1) / PAGE_SIZE)
        val rootIv = MessageDigest.getInstance("MD5").digest(fek)
        RandomAccessFile(dir.resolve(name).toFile(), "rw").use { raf ->
            raf.setLength(0)
            val header = ByteArray(HEADER_SIZE)
            writeLong(header, 0, plaintext.size.toLong())
            val magic1 = 0x624B34D3L
            writeInt(header, 8, magic1)
            writeInt(header, 12, magic1 xor MAGIC)
            writeInt(header, 16, 0x03000002)
            writeInt(header, 20, PAGE_SIZE)
            header[24] = 0; header[25] = 2 // extent count u16 = 2
            writeInt(header, 4096, keyId)
            System.arraycopy(publicKeyBlob(), 0, header, 4100, 65)
            System.arraycopy(vin.toByteArray(Charsets.US_ASCII), 0, header, 4165, 17)
            writeLong(header, 4182, timestamp)
            System.arraycopy(wrappedKeyBlob(), 0, header, 4190, 44)
            raf.write(header)
            for (p in 0 until pages) {
                val iv = deriveIv(rootIv, p)
                val from = p * PAGE_SIZE
                val block = plaintext.copyOfRange(from, minOf(from + PAGE_SIZE, plaintext.size))
                val padded = block.copyOf(PAGE_SIZE) // NUL pad to full page
                val ct = Cipher.getInstance("AES/CBC/NoPadding").run {
                    init(Cipher.ENCRYPT_MODE, SecretKeySpec(fek, "AES"), IvParameterSpec(iv))
                    doFinal(padded)
                }
                raf.write(ct)
            }
        }
        return dir.resolve(name)
    }

    fun buildPlain(dir: Path, name: String, bytes: Int = 4096): Path {
        val p = dir.resolve(name)
        Files.write(p, ByteArray(bytes) { (it % 251).toByte() })
        return p
    }

    private fun writeInt(b: ByteArray, off: Int, v: Long) {
        b[off] = (v ushr 24).toByte(); b[off + 1] = (v ushr 16).toByte()
        b[off + 2] = (v ushr 8).toByte(); b[off + 3] = v.toByte()
    }

    private fun writeLong(b: ByteArray, off: Int, v: Long) {
        for (i in 0 until 8) b[off + i] = (v ushr (8 * (7 - i))).toByte()
    }
}
```

`backend/src/test/kotlin/dev/teslacam/encrypt/EcryptfsHeaderTest.kt`:

```kotlin
package dev.teslacam.encrypt

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

class EcryptfsHeaderTest {
    @TempDir lateinit var dir: Path

    @Test
    fun `plain files are not detected as encrypted`() {
        val p = TestClips.buildPlain(dir, "plain.mp4")
        assertNull(EcryptfsHeaderReader.read(p))
    }

    @Test
    fun `valid encrypted file is parsed`() {
        val p = TestClips.buildEncrypted(dir, "clip.mp4", ByteArray(5000) { 0x11 })
        val h = EcryptfsHeaderReader.read(p)!!
        assertEquals(5000L, h.plaintextSize)
        assertEquals(7L, h.keyId)
        assertEquals("LRW3E7EK5MC000000", h.vin)
        assertEquals(1_700_000_000_000L, h.timestamp)
        assertArrayEquals(TestClips.publicKeyBlob(), h.publicKey)
        assertArrayEquals(TestClips.wrappedKeyBlob(), h.wrappedKey)
        assertEquals("LRW3E7EK5MC000000:7:1700000000000", h.storeKey)
    }

    @Test
    fun `file shorter than header is plain`() {
        val p = TestClips.buildPlain(dir, "tiny.mp4", 100)
        assertNull(EcryptfsHeaderReader.read(p))
    }

    @Test
    fun `length not multiple of page size is plain`() {
        val p = TestClips.buildEncrypted(dir, "clip.mp4", ByteArray(5000))
        java.nio.file.Files.write(p, java.nio.file.Files.readAllBytes(p) + 1)
        assertNull(EcryptfsHeaderReader.read(p))
    }

    @Test
    fun `broken magic is plain`() {
        val p = TestClips.buildEncrypted(dir, "clip.mp4", ByteArray(5000))
        val raf = java.io.RandomAccessFile(p.toFile(), "rw")
        raf.seek(8); raf.writeInt(0x11223344); raf.close()
        assertNull(EcryptfsHeaderReader.read(p))
    }

    @Test
    fun `plaintext size beyond file is rejected`() {
        val p = TestClips.buildEncrypted(dir, "clip.mp4", ByteArray(5000))
        val raf = java.io.RandomAccessFile(p.toFile(), "rw")
        raf.seek(0); raf.writeLong(Long.MAX_VALUE); raf.close()
        assertNull(EcryptfsHeaderReader.read(p))
    }

    @Test
    fun `bad version flags rejected`() {
        val p = TestClips.buildEncrypted(dir, "clip.mp4", ByteArray(5000))
        val raf = java.io.RandomAccessFile(p.toFile(), "rw")
        raf.seek(16); raf.writeInt(0x03000003); raf.close()
        assertNull(EcryptfsHeaderReader.read(p))
    }

    @Test
    fun `bad page size rejected`() {
        val p = TestClips.buildEncrypted(dir, "clip.mp4", ByteArray(5000))
        val raf = java.io.RandomAccessFile(p.toFile(), "rw")
        raf.seek(20); raf.writeInt(8192); raf.close()
        assertNull(EcryptfsHeaderReader.read(p))
    }

    @Test
    fun `non-04 public key first byte rejected`() {
        val p = TestClips.buildEncrypted(dir, "clip.mp4", ByteArray(5000))
        val raf = java.io.RandomAccessFile(p.toFile(), "rw")
        raf.seek(4100); raf.write(0x05); raf.close()
        assertNull(EcryptfsHeaderReader.read(p))
    }

    @Test
    fun `vin starting with NUL rejected`() {
        val p = TestClips.buildEncrypted(dir, "clip.mp4", ByteArray(5000))
        val raf = java.io.RandomAccessFile(p.toFile(), "rw")
        raf.seek(4165); raf.write(0); raf.close()
        assertNull(EcryptfsHeaderReader.read(p))
    }

    @Test
    fun `detector caches and invalidates on change`() {
        val p = TestClips.buildEncrypted(dir, "clip.mp4", ByteArray(5000))
        val detector = EncryptionDetector()
        assertNotNull(detector.headerFor(p))
        Thread.sleep(5) // ensure mtime differs
        java.nio.file.Files.write(p, ByteArray(4096))
        assertNull(detector.headerFor(p))
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./gradlew test --tests "dev.teslacam.encrypt.EcryptfsHeaderTest"`
Expected: compilation FAIL — `EcryptfsHeaderReader` / `EncryptionDetector` unresolved.

- [ ] **Step 3: Write minimal implementation**

`backend/src/main/kotlin/dev/teslacam/encrypt/EcryptfsHeader.kt`:

```kotlin
package dev.teslacam.encrypt

import java.io.RandomAccessFile
import java.nio.file.Path
import java.util.Base64

/**
 * Tesla's eCryptfs-style encrypted-clip header (8 KiB, see spec). All integers big-endian.
 */
class EcryptfsHeader(
    val plaintextSize: Long,
    val keyId: Long,
    val vin: String,
    val timestamp: Long,
    val publicKey: ByteArray,
    val wrappedKey: ByteArray,
) {
    val storeKey: String get() = "$vin:$keyId:$timestamp"
    val publicKeyB64: String get() = Base64.getEncoder().encodeToString(publicKey)
    val wrappedKeyB64: String get() = Base64.getEncoder().encodeToString(wrappedKey)
}

object EcryptfsHeaderReader {
    const val HEADER_SIZE = 8192
    const val PAGE_SIZE = 4096
    private const val MAGIC = 0x3C81B7F5L
    private const val VERSION = 0x03000002L

    /** Full validation + parse. Returns null for plain files or any validation failure. */
    fun read(path: Path): EcryptfsHeader? = runCatching {
        RandomAccessFile(path.toFile(), "r").use { raf ->
            val len = raf.length()
            if (len < HEADER_SIZE || len % PAGE_SIZE != 0L) return@use null
            val header = ByteArray(HEADER_SIZE)
            raf.readFully(header)
            val plaintextSize = readLong(header, 0)
            if (plaintextSize > len - HEADER_SIZE) return@use null
            if (readInt(header, 8) xor readInt(header, 12) != MAGIC) return@use null
            if (readInt(header, 16) != VERSION) return@use null
            if (readInt(header, 20) != PAGE_SIZE) return@use null
            val extentCount = (header[24].toInt() and 0xFF shl 8) or (header[25].toInt() and 0xFF)
            if (extentCount != 2) return@use null
            val keyId = readInt(header, 4096) and 0xFFFFFFFFL
            val publicKey = header.copyOfRange(4100, 4165)
            if (publicKey[0] != 0x04.toByte()) return@use null
            val vinBytes = header.copyOfRange(4165, 4182)
            if (vinBytes[0] == 0.toByte()) return@use null
            val vin = String(vinBytes, Charsets.US_ASCII).trimEnd(' ')
            val timestamp = readLong(header, 4182)
            val wrappedKey = header.copyOfRange(4190, 4234)
            EcryptfsHeader(plaintextSize, keyId, vin, timestamp, publicKey, wrappedKey)
        }
    }.getOrNull()

    private fun readInt(b: ByteArray, off: Int): Long =
        (b[off].toLong() and 0xFF shl 24) or (b[off + 1].toLong() and 0xFF shl 16) or
            (b[off + 2].toLong() and 0xFF shl 8) or (b[off + 3].toLong() and 0xFF)

    private fun readLong(b: ByteArray, off: Int): Long {
        var v = 0L
        for (i in 0 until 8) v = (v shl 8) or (b[off + i].toLong() and 0xFF)
        return v
    }
}
```

`backend/src/main/kotlin/dev/teslacam/encrypt/EncryptionDetector.kt`:

```kotlin
package dev.teslacam.encrypt

import org.springframework.stereotype.Component
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.FileTime
import java.util.concurrent.ConcurrentHashMap

/**
 * Caches per-file header parses, keyed by path and invalidated when the file's
 * mtime+size change (TeslaCam rotates files; paths get reused).
 */
@Component
class EncryptionDetector {
    private data class Entry(val mtime: FileTime, val size: Long, val header: EcryptfsHeader?)
    private val cache = ConcurrentHashMap<String, Entry>()

    fun headerFor(path: Path): EcryptfsHeader? {
        val mtime = Files.getLastModifiedTime(path)
        val size = Files.size(path)
        val key = path.toAbsolutePath().toString()
        val existing = cache[key]
        if (existing != null && existing.mtime == mtime && existing.size == size) return existing.header
        val header = EcryptfsHeaderReader.read(path)
        cache[key] = Entry(mtime, size, header)
        return header
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./gradlew test --tests "dev.teslacam.encrypt.EcryptfsHeaderTest"`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/kotlin/dev/teslacam/encrypt/EcryptfsHeader.kt \
        backend/src/main/kotlin/dev/teslacam/encrypt/EncryptionDetector.kt \
        backend/src/test/kotlin/dev/teslacam/encrypt/TestClips.kt \
        backend/src/test/kotlin/dev/teslacam/encrypt/EcryptfsHeaderTest.kt
git commit -m "feat(encrypt): parse eCryptfs clip headers to detect encrypted clips"
```

---

### Task 2: PageDecryptor (AES-128-CBC page decryption)

**Files:**
- Create: `backend/src/main/kotlin/dev/teslacam/encrypt/PageDecryptor.kt`
- Test: `backend/src/test/kotlin/dev/teslacam/encrypt/PageDecryptorTest.kt`

**Interfaces:**
- Consumes: `EcryptfsHeaderReader.PAGE_SIZE` (Task 1), `TestClips` builder.
- Produces: `class PageDecryptor(fek: ByteArray)` with:
  - `fun deriveIv(pageNo: Int): ByteArray`
  - `fun decryptPage(page: ByteArray, pageNo: Int): ByteArray` — one 4096-byte ciphertext page → 4096 plaintext bytes.

- [ ] **Step 1: Write the failing test**

```kotlin
package dev.teslacam.encrypt

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.nio.file.Files

class PageDecryptorTest {
    private val fek = TestClips.fek()

    @Test
    fun `round-trips a full synthetic clip`() {
        val tmp = Files.createTempDirectory("pg")
        val plaintext = ByteArray(3 * 4096 + 137) { (it % 256).toByte() }
        val file = TestClips.buildEncrypted(tmp, "clip.mp4", plaintext)
        val all = Files.readAllBytes(file)
        val dec = PageDecryptor(fek)
        val out = java.io.ByteArrayOutputStream()
        val pageCount = (all.size - 8192) / 4096
        for (p in 0 until pageCount) {
            out.write(dec.decryptPage(all.copyOfRange(8192 + p * 4096, 8192 + (p + 1) * 4096), p))
        }
        assertEquals(pageCount * 4096, out.size()) // NoPadding: full pages back
        assertArrayEquals(plaintext, out.toByteArray().copyOf(plaintext.size))
    }

    @Test
    fun `page decrypts identically out of order`() {
        val tmp = Files.createTempDirectory("pg2")
        val file = TestClips.buildEncrypted(tmp, "c.mp4", ByteArray(4096 * 9))
        val all = Files.readAllBytes(file)
        val dec = PageDecryptor(fek)
        val page7 = dec.decryptPage(all.copyOfRange(8192 + 7 * 4096, 8192 + 8 * 4096), 7)
        assertArrayEquals(ByteArray(4096), page7)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./gradlew test --tests "dev.teslacam.encrypt.PageDecryptorTest"`
Expected: compilation FAIL — `PageDecryptor` unresolved.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/dev/teslacam/encrypt/PageDecryptor.kt`:

```kotlin
package dev.teslacam.encrypt

import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * AES-128-CBC NoPadding page decryption of eCryptfs clips (IV scheme in spec).
 * A fresh Cipher is created per page (Cipher is not thread-safe); one instance
 * per request is fine, and instances may be shared across threads.
 */
class PageDecryptor(fek: ByteArray) {
    private val key = SecretKeySpec(fek, "AES")
    private val rootIv = MessageDigest.getInstance("MD5").digest(fek) // 16 bytes

    fun deriveIv(pageNo: Int): ByteArray {
        val buf = ByteArray(32)
        System.arraycopy(rootIv, 0, buf, 0, 16)
        val digits = pageNo.toString().toByteArray(Charsets.US_ASCII)
        System.arraycopy(digits, 0, buf, 16, digits.size)
        return MessageDigest.getInstance("MD5").digest(buf).copyOf(16)
    }

    /** Decrypts one full 4096-byte ciphertext page. */
    fun decryptPage(page: ByteArray, pageNo: Int): ByteArray {
        require(page.size == EcryptfsHeaderReader.PAGE_SIZE) { "page must be ${EcryptfsHeaderReader.PAGE_SIZE} bytes" }
        val cipher = Cipher.getInstance("AES/CBC/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, IvParameterSpec(deriveIv(pageNo)))
        return cipher.doFinal(page)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./gradlew test --tests "dev.teslacam.encrypt.PageDecryptorTest"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/kotlin/dev/teslacam/encrypt/PageDecryptor.kt \
        backend/src/test/kotlin/dev/teslacam/encrypt/PageDecryptorTest.kt
git commit -m "feat(encrypt): AES-128-CBC page decryptor with deterministic per-page IVs"
```

---

### Task 3: TeslaKeyStore (`.teslacam_keys.json`)

**Files:**
- Create: `backend/src/main/kotlin/dev/teslacam/encrypt/TeslaKeyStore.kt`
- Test: `backend/src/test/kotlin/dev/teslacam/encrypt/TeslaKeyStoreTest.kt`

**Interfaces:**
- Consumes: nothing.
- Produces: `@Component class TeslaKeyStore(root: String)` with:
  - `fun get(storeKey: String): String?` — base64 FEK or null
  - `fun putAll(newKeys: Map<String, String>): Int` — merges (putIfAbsent), persists, returns count newly added
  - `fun size(): Int`

- [ ] **Step 1: Write the failing tests**

```kotlin
package dev.teslacam.encrypt

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

class TeslaKeyStoreTest {
    @TempDir lateinit var dir: Path

    @Test
    fun `persists across instances`() {
        TeslaKeyStore(dir.toString()).putAll(mapOf("VIN:1:2" to "AAAA"))
        assertEquals("AAAA", TeslaKeyStore(dir.toString()).get("VIN:1:2"))
    }

    @Test
    fun `missing file behaves as empty`() {
        assertEquals(0, TeslaKeyStore(dir.toString()).size())
        assertNull(TeslaKeyStore(dir.toString()).get("VIN:1:2"))
    }

    @Test
    fun `putAll is idempotent and counts only new keys`() {
        val store = TeslaKeyStore(dir.toString())
        assertEquals(1, store.putAll(mapOf("VIN:1:2" to "AAAA")))
        assertEquals(0, store.putAll(mapOf("VIN:1:2" to "BBBB"))) // putIfAbsent: no overwrite
        assertEquals("AAAA", store.get("VIN:1:2"))
    }

    @Test
    fun `corrupt file does not crash load`() {
        java.nio.file.Files.writeString(dir.resolve(".teslacam_keys.json"), "{not json")
        assertEquals(0, TeslaKeyStore(dir.toString()).size())
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./gradlew test --tests "dev.teslacam.encrypt.TeslaKeyStoreTest"`
Expected: compilation FAIL.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/dev/teslacam/encrypt/TeslaKeyStore.kt`:

```kotlin
package dev.teslacam.encrypt

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import jakarta.annotation.PostConstruct
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.concurrent.ConcurrentHashMap

/**
 * FEK cache persisted as JSON at `<teslacam.root>/.teslacam_keys.json`,
 * mapping "<vin>:<key_id>:<timestamp>" -> base64 16-byte FEK.
 * Never logs FEK values.
 */
@Component
class TeslaKeyStore(@Value("\${teslacam.root}") root: String) {
    private val file = Path.of(root).resolve(".teslacam_keys.json")
    private val keys = ConcurrentHashMap<String, String>()
    private val mapper = ObjectMapper().registerKotlinModule()
    private val lock = Any()

    @PostConstruct
    fun load(): Unit = runCatching {
        if (Files.isRegularFile(file)) {
            val map: Map<String, String> =
                mapper.readValue(file.toFile(), mapper.typeFactory.constructMapType(Map::class.java, String::class.java, String::class.java))
            keys.putAll(map)
        }
    }.getOrDefault(Unit)

    fun get(storeKey: String): String? = keys[storeKey]

    fun size(): Int = keys.size

    fun putAll(newKeys: Map<String, String>): Int = synchronized(lock) {
        var added = 0
        for ((k, v) in newKeys) if (keys.putIfAbsent(k, v) == null) added++
        if (added > 0) save()
        added
    }

    private fun save(): Unit = runCatching {
        val tmp = file.resolveSibling(".teslacam_keys.json.tmp")
        Files.write(tmp, mapper.writeValueAsBytes(keys))
        Files.move(tmp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }.onFailure { it.printStackTrace() }.getOrDefault(Unit)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./gradlew test --tests "dev.teslacam.encrypt.TeslaKeyStoreTest"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/kotlin/dev/teslacam/encrypt/TeslaKeyStore.kt \
        backend/src/test/kotlin/dev/teslacam/encrypt/TeslaKeyStoreTest.kt
git commit -m "feat(encrypt): persistent FEK store (.teslacam_keys.json)"
```

---

### Task 4: TeslaKeyClient (batched FEK fetch)

**Files:**
- Create: `backend/src/main/kotlin/dev/teslacam/encrypt/TeslaKeyClient.kt`
- Test: `backend/src/test/kotlin/dev/teslacam/encrypt/TeslaKeyClientTest.kt`

**Interfaces:**
- Consumes: nothing (Tesla HTTP API).
- Produces:
  - `data class KeyItem(id: String, vin: String, keyId: Long, timestamp: Long, wrappedKey: String, publicKey: String)` — camelCase JSON DTO shared by scanner, keys endpoint and frontend. (blobs are base64 strings)
  - `@Component class TeslaKeyClient(builder: RestClient.Builder)` with `fun fetchKeys(items: List<KeyItem>, accessToken: String): Map<String, String>` — id → base64 FEK, non-empty only. Splits into ≤30-item batches, sends snake_case batch items, normalizes all three response shapes.
  - Exceptions (top-level in same file, extend `TeslaKeyException : RuntimeException`): `AkamaiChallenge`, `AuthError`, `ApiError(val status: Int, val body: String)`, `NetworkError`.

- [ ] **Step 1: Write the failing tests**

```kotlin
package dev.teslacam.encrypt

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.web.client.RestClient
import org.springframework.test.web.client.match.MockRestRequestMatchers.*
import org.springframework.test.web.client.response.MockRestResponseCreators.*

class TeslaKeyClientTest {
    private fun client(): Pair<TeslaKeyClient, MockRestServiceServer> {
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        return TeslaKeyClient(builder) to server
    }

    private fun item(id: String) = KeyItem(id, "VIN", 7, 1000L, "d3JhcHBlZA==", "cHVi")

    @Test
    fun `results array shape is normalized`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(
            withSuccess("""{"results":[{"id":"a","key":"QUJD"},{"id":"b","key":""}]}""", MediaType.APPLICATION_JSON))
        val out = client.fetchKeys(listOf(item("a"), item("b")), "tok")
        assertEquals(mapOf("a" to "QUJD"), out) // empty key dropped
    }

    @Test
    fun `bare list shape is normalized`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(
            withSuccess("""[{"id":"a","key":"QUJD"}]""", MediaType.APPLICATION_JSON))
        assertEquals(mapOf("a" to "QUJD"), client.fetchKeys(listOf(item("a")), "tok"))
    }

    @Test
    fun `flat map shape is normalized`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(
            withSuccess("""{"a":"QUJD","b":""}""", MediaType.APPLICATION_JSON))
        assertEquals(mapOf("a" to "QUJD"), client.fetchKeys(listOf(item("a"), item("b")), "tok"))
    }

    @Test
    fun `items are batched at 30 per request`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(
            withSuccess("""{"results":[]}""", MediaType.APPLICATION_JSON))
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(
            withSuccess("""{"results":[]}""", MediaType.APPLICATION_JSON))
        val items = (0 until 35).map { item("id$it") }
        client.fetchKeys(items, "tok")
        server.verify()
    }

    @Test
    fun `batch request carries snake_case fields and bearer token`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL))
            .andExpect(header("Authorization", "Bearer tok"))
            .andExpect(jsonPath("$.items[0].key_id").value(7))
            .andExpect(jsonPath("$.items[0].wrapped_key").value("d3JhcHBlZA=="))
            .andRespond(withSuccess("""{"results":[{"id":"a","key":"QUJD"}]}""", MediaType.APPLICATION_JSON))
        assertEquals(mapOf("a" to "QUJD"), client.fetchKeys(listOf(item("a")), "tok"))
    }

    @Test
    fun `403 maps to AkamaiChallenge`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(withStatus(403))
        assertThrows(AkamaiChallenge::class.java) { client.fetchKeys(listOf(item("a")), "tok") }
    }

    @Test
    fun `401 maps to AuthError`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(withStatus(401))
        assertThrows(AuthError::class.java) { client.fetchKeys(listOf(item("a")), "tok") }
    }

    @Test
    fun `500 maps to ApiError`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaKeyClient.BATCH_URL)).andRespond(withServerError())
        assertThrows(ApiError::class.java) { client.fetchKeys(listOf(item("a")), "tok") }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./gradlew test --tests "dev.teslacam.encrypt.TeslaKeyClientTest"`
Expected: compilation FAIL.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/dev/teslacam/encrypt/TeslaKeyClient.kt`:

```kotlin
package dev.teslacam.encrypt

import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientResponseException

/** Frontend-facing wrapped-key item (camelCase JSON); id = root-relative file path. */
data class KeyItem(
    val id: String,
    val vin: String,
    val keyId: Long,
    val timestamp: Long,
    val wrappedKey: String, // base64, 44 bytes
    val publicKey: String,  // base64, 65 bytes
) {
    val storeKey: String get() = "$vin:$keyId:$timestamp"
}

open class TeslaKeyException(message: String) : RuntimeException(message)
class AkamaiChallenge(message: String) : TeslaKeyException(message)
class AuthError(message: String) : TeslaKeyException(message)
class ApiError(val status: Int, val body: String) : TeslaKeyException("HTTP $status: ${body.take(200)}")
class NetworkError(message: String) : TeslaKeyException(message)

@Component
class TeslaKeyClient(builder: RestClient.Builder) {
    companion object {
        const val BATCH_URL = "https://dashcam.tesla.com/api/1/decrypt/batch"
        const val MAX_BATCH = 30
        private const val BROWSER_UA =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    }

    private val rest = builder.build()
    private val mapper = ObjectMapper().registerKotlinModule()

    fun fetchKeys(items: List<KeyItem>, accessToken: String): Map<String, String> {
        if (items.isEmpty()) return emptyMap()
        val out = mutableMapOf<String, String>()
        for (batch in items.chunked(MAX_BATCH)) out.putAll(execute(batch, accessToken))
        return out
    }

    private fun execute(batch: List<KeyItem>, token: String): Map<String, String> {
        val body = mapOf("items" to batch.map { BatchItem(it.id, it.vin, it.keyId, it.timestamp, it.wrappedKey, it.publicKey) })
        val raw = try {
            rest.post()
                .uri(BATCH_URL)
                .header("Authorization", "Bearer $token")
                .header("User-Agent", BROWSER_UA)
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(String::class.java)
                ?: throw ApiError(200, "empty response body")
        } catch (e: RestClientResponseException) {
            when (e.statusCode.value()) {
                403 -> throw AkamaiChallenge("Tesla blocked the key request (Akamai challenge, HTTP 403)")
                401 -> throw AuthError("Tesla rejected the access token (HTTP 401)")
                else -> throw ApiError(e.statusCode.value(), e.responseBodyAsString.take(500))
            }
        } catch (e: Exception) {
            throw NetworkError(e.message ?: "network failure")
        }
        return normalizeResults(raw)
    }

    /** Accepts {"results":[{id,key}]} | [{id,key}] | {"<id>":"<key>"}; drops empty keys. */
    private fun normalizeResults(raw: String): Map<String, String> {
        val root = mapper.readTree(raw)
        val pairs: List<Pair<String, String>> = when {
            root.has("results") && root["results"].isArray ->
                root["results"].map { it.path("id").asText() to it.path("key").asText("") }
            root.isArray ->
                root.map { it.path("id").asText() to it.path("key").asText("") }
            root.isObject ->
                root.properties().map { (id, v) -> id to v.asText("") }
            else -> emptyList()
        }
        return pairs.filter { it.second.isNotBlank() }.toMap()
    }

    private data class BatchItem(
        @JsonProperty("id") val id: String,
        @JsonProperty("vin") val vin: String,
        @JsonProperty("key_id") val keyId: Long,
        @JsonProperty("timestamp") val timestamp: Long,
        @JsonProperty("wrapped_key") val wrappedKey: String,
        @JsonProperty("public_key") val publicKey: String,
    )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./gradlew test --tests "dev.teslacam.encrypt.TeslaKeyClientTest"`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/kotlin/dev/teslacam/encrypt/TeslaKeyClient.kt \
        backend/src/test/kotlin/dev/teslacam/encrypt/TeslaKeyClientTest.kt
git commit -m "feat(encrypt): batched FEK fetch client for Tesla decrypt/batch API"
```

---

### Task 5: Tesla auth — PKCE minting, code exchange, refresh (backend)

**Files:**
- Create: `backend/src/main/kotlin/dev/teslacam/encrypt/TeslaAuthClient.kt`
- Create: `backend/src/main/kotlin/dev/teslacam/api/TeslaAuthController.kt`
- Test: `backend/src/test/kotlin/dev/teslacam/encrypt/TeslaAuthClientTest.kt`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `data class TeslaTokens(accessToken: String, refreshToken: String, expiresAt: Long)` — `expiresAt` = epoch millis, now + `expires_in` − 60 s margin.
  - `class TeslaAuthClient(builder: RestClient.Builder)` with:
    - `fun exchangeCode(code: String, verifier: String): TeslaTokens`
    - `fun refresh(refreshToken: String): TeslaTokens` (reuses old refresh token if response omits one)
    - `fun mintPkce(): PkceChallenge` where `data class PkceChallenge(verifier: String, challenge: String, state: String)` — verifier = base64url(SecureRandom 32 B), challenge = base64url(SHA-256(verifier)), state = 32-char hex (SecureRandom 16 B).
  - `@RestController class TeslaAuthController`:
    - `GET /api/tesla/pkce` → `{verifier, challenge, state}`
    - `POST /api/tesla/token` `{code, verifier}` → `TeslaTokens` JSON; 401 body `{"error":"token_exchange_failed"}` on Tesla rejection
    - `POST /api/tesla/refresh` `{refreshToken}` → `TeslaTokens` JSON; 401 body `{"error":"refresh_failed"}`

- [ ] **Step 1: Write the failing tests**

```kotlin
package dev.teslacam.encrypt

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.web.client.RestClient
import org.springframework.test.web.client.match.MockRestRequestMatchers.*
import org.springframework.test.web.client.response.MockRestResponseCreators.*

class TeslaAuthClientTest {
    private fun client(): Pair<TeslaAuthClient, MockRestServiceServer> {
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        return TeslaAuthClient(builder) to server
    }

    @Test
    fun `exchangeCode posts form grant and maps token response`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaAuthClient.TOKEN_URL))
            .andExpect(method(HttpMethod.POST))
            .andExpect(content().string(
                org.hamcrest.Matchers.containsString("grant_type=authorization_code")))
            .andRespond(withSuccess(
                """{"access_token":"at","refresh_token":"rt","expires_in":3600}""",
                MediaType.APPLICATION_JSON))
        val tokens = client.exchangeCode("the-code", "the-verifier")
        assertEquals("at", tokens.accessToken)
        assertEquals("rt", tokens.refreshToken)
        assertTrue(tokens.expiresAt > System.currentTimeMillis() + 300_000)
    }

    @Test
    fun `refresh reuses old refresh token when response omits one`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaAuthClient.TOKEN_URL))
            .andExpect(content().string(org.hamcrest.Matchers.containsString("grant_type=refresh_token")))
            .andRespond(withSuccess(
                """{"access_token":"at2","expires_in":3600}""", MediaType.APPLICATION_JSON))
        val tokens = client.refresh("old-rt")
        assertEquals("at2", tokens.accessToken)
        assertEquals("old-rt", tokens.refreshToken)
    }

    @Test
    fun `failed exchange maps to AuthError`() {
        val (client, server) = client()
        server.expect(requestTo(TeslaAuthClient.TOKEN_URL))
            .andRespond(withBadRequest().body("""{"error":"invalid_grant"}"""))
        assertThrows(AuthError::class.java) { client.exchangeCode("c", "v") }
    }

    @Test
    fun `mintPkce returns distinct verifiers and s256 challenge`() {
        val (client, _) = client()
        val a = client.mintPkce()
        val b = client.mintPkce()
        assertEquals(43, a.verifier.length) // base64url(32B)
        assertNotEquals(a.verifier, b.verifier)
        val expected = java.util.Base64.getUrlEncoder().withoutPadding()
            .encodeToString(java.security.MessageDigest.getInstance("SHA-256")
                .digest(a.verifier.toByteArray(Charsets.US_ASCII)))
        assertEquals(expected, a.challenge)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./gradlew test --tests "dev.teslacam.encrypt.TeslaAuthClientTest"`
Expected: compilation FAIL.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/dev/teslacam/encrypt/TeslaAuthClient.kt`:

```kotlin
package dev.teslacam.encrypt

import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.util.LinkedMultiValueMap
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientResponseException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

data class TeslaTokens(val accessToken: String, val refreshToken: String, val expiresAt: Long)
data class PkceChallenge(val verifier: String, val challenge: String, val state: String)

@Component
class TeslaAuthClient(private val builder: RestClient.Builder) {
    companion object {
        const val TOKEN_URL = "https://auth.tesla.com/oauth2/v3/token"
        const val REDIRECT_URI = "https://dashcam.tesla.com/callback"
        const val CLIENT_ID = "dashcam"
        private val random = SecureRandom()
    }

    private val rest by lazy { builder.build() }
    private val mapper = com.fasterxml.jackson.databind.ObjectMapper()
        .registerKotlinModule(com.fasterxml.jackson.module.kotlin.KotlinModule.Builder().build())

    fun mintPkce(): PkceChallenge {
        val verifierBytes = ByteArray(32); random.nextBytes(verifierBytes)
        val verifier = Base64.getUrlEncoder().withoutPadding().encodeToString(verifierBytes)
        val challenge = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
        val stateBytes = ByteArray(16); random.nextBytes(stateBytes)
        val state = java.lang.Long.toHexString(random.nextLong()) + java.lang.Long.toHexString(random.nextLong())
        return PkceChallenge(verifier, challenge, state)
    }

    fun exchangeCode(code: String, verifier: String): TeslaTokens =
        token(mapOf(
            "grant_type" to "authorization_code",
            "client_id" to CLIENT_ID,
            "code" to code,
            "redirect_uri" to REDIRECT_URI,
            "code_verifier" to verifier,
        ))

    fun refresh(refreshToken: String): TeslaTokens {
        val tokens = token(mapOf(
            "grant_type" to "refresh_token",
            "client_id" to CLIENT_ID,
            "refresh_token" to refreshToken,
        ))
        return if (tokens.refreshToken.isBlank()) tokens.copy(refreshToken = refreshToken) else tokens
    }

    private fun token(form: Map<String, String>): TeslaTokens {
        val entity = LinkedMultiValueMap<String, String>().apply { form.forEach { (k, v) -> add(k, v) } }
        val raw = try {
            rest.post()
                .uri(TOKEN_URL)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(entity)
                .retrieve()
                .body(String::class.java)
                ?: throw AuthError("empty token response")
        } catch (e: RestClientResponseException) {
            throw AuthError("token endpoint HTTP ${e.statusCode.value()}: ${e.responseBodyAsString.take(200)}")
        }
        val tree = mapper.readTree(raw)
        val access = tree.path("access_token").asText("")
        if (access.isBlank()) throw AuthError("token response missing access_token")
        val expiresIn = tree.path("expires_in").asLong(3600)
        return TeslaTokens(
            accessToken = access,
            refreshToken = tree.path("refresh_token").asText(""),
            expiresAt = System.currentTimeMillis() + (expiresIn - 60) * 1000,
        )
    }
}
```

`backend/src/main/kotlin/dev/teslacam/api/TeslaAuthController.kt`:

```kotlin
package dev.teslacam.api

import dev.teslacam.encrypt.*
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/tesla")
class TeslaAuthController(private val auth: TeslaAuthClient) {

    @GetMapping("/pkce")
    fun pkce(): PkceChallenge = auth.mintPkce()

    @PostMapping("/token")
    fun token(@RequestBody body: Map<String, String>): ResponseEntity<Any> {
        val code = body["code"] ?: return badRequest()
        val verifier = body["verifier"] ?: return badRequest()
        return try {
            ResponseEntity.ok(auth.exchangeCode(code, verifier))
        } catch (_: AuthError) {
            ResponseEntity.status(401).body(mapOf("error" to "token_exchange_failed"))
        }
    }

    @PostMapping("/refresh")
    fun refresh(@RequestBody body: Map<String, String>): ResponseEntity<Any> {
        val rt = body["refreshToken"] ?: return badRequest()
        return try {
            ResponseEntity.ok(auth.refresh(rt))
        } catch (_: AuthError) {
            ResponseEntity.status(401).body(mapOf("error" to "refresh_failed"))
        }
    }

    private fun badRequest() = ResponseEntity.badRequest().body(mapOf("error" to "missing_parameter"))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./gradlew test --tests "dev.teslacam.encrypt.TeslaAuthClientTest"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/kotlin/dev/teslacam/encrypt/TeslaAuthClient.kt \
        backend/src/main/kotlin/dev/teslacam/api/TeslaAuthController.kt \
        backend/src/test/kotlin/dev/teslacam/encrypt/TeslaAuthClientTest.kt
git commit -m "feat(encrypt): Tesla OAuth token exchange, refresh and PKCE minting"
```

---

### Task 6: Encrypted media serving with Range support

**Files:**
- Create: `backend/src/main/kotlin/dev/teslacam/encrypt/EncryptedMediaService.kt`
- Modify: `backend/src/main/kotlin/dev/teslacam/api/MediaController.kt`
- Test: `backend/src/test/kotlin/dev/teslacam/encrypt/EncryptedMediaServiceTest.kt`
- Test: `backend/src/test/kotlin/dev/teslacam/api/MediaControllerEncryptTest.kt`

**Interfaces:**
- Consumes: `EncryptionDetector`/`EcryptfsHeader` (Task 1), `PageDecryptor` (Task 2), `TeslaKeyStore` (Task 3), `TestClips`.
- Produces:
  - `@Component class EncryptedMediaService(detector: EncryptionDetector, keyStore: TeslaKeyStore)` with:
    - `fun requireFek(header: EcryptfsHeader): ByteArray` — base64-decodes the stored FEK, throws `MissingKeyException(header.storeKey)` when absent or not 16 bytes
    - `fun writeRange(path: Path, header: EcryptfsHeader, fek: ByteArray, start: Long, endInclusive: Long, out: OutputStream)` — seeks to the page containing `start`, decrypts forward page-by-page, writes only the `[start..endInclusive]` slice. Caller guarantees `endInclusive ≤ plaintextSize − 1`.
    - `class MissingKeyException(val storeKey: String) : RuntimeException`
  - `MediaController` encrypted branch: 200 full / 206 single range / 416 + `Content-Range: bytes */size`; 409 `{"error":"missing_key"}` when FEK missing; unparseable `Range` → 200 full (RFC allows ignoring).

- [ ] **Step 1: Write the failing tests**

`backend/src/test/kotlin/dev/teslacam/encrypt/EncryptedMediaServiceTest.kt`:

```kotlin
package dev.teslacam.encrypt

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.nio.file.Path

class EncryptedMediaServiceTest {
    @TempDir lateinit var dir: Path
    private val plaintext = ByteArray(3 * 4096 + 137) { (it % 256).toByte() }

    private fun service(): EncryptedMediaService {
        val keyStore = TeslaKeyStore(dir.toString())
        keyStore.putAll(mapOf("LRW3E7EK5MC000000:7:1700000000000" to java.util.Base64.getEncoder().encodeToString(TestClips.fek())))
        return EncryptedMediaService(EncryptionDetector(), keyStore)
    }

    @Test
    fun `full range returns exact plaintext`() {
        val file = TestClips.buildEncrypted(dir, "clip.mp4", plaintext)
        val h = EncryptionDetector().headerFor(file)!!
        val out = ByteArrayOutputStream()
        service().writeRange(file, h, TestClips.fek(), 0, plaintext.size - 1L, out)
        assertArrayEquals(plaintext, out.toByteArray())
    }

    @Test
    fun `mid-page range crosses pages correctly`() {
        val file = TestClips.buildEncrypted(dir, "clip.mp4", plaintext)
        val h = EncryptionDetector().headerFor(file)!!
        val out = ByteArrayOutputStream()
        service().writeRange(file, h, TestClips.fek(), 5000L, 9000L, out)
        assertArrayEquals(plaintext.copyOfRange(5000, 9001), out.toByteArray())
    }

    @Test
    fun `tail range stops before page padding`() {
        val file = TestClips.buildEncrypted(dir, "clip.mp4", plaintext)
        val h = EncryptionDetector().headerFor(file)!!
        val out = ByteArrayOutputStream()
        service().writeRange(file, h, TestClips.fek(), plaintext.size - 10L, plaintext.size - 1L, out)
        assertArrayEquals(plaintext.copyOfRange(plaintext.size - 10, plaintext.size), out.toByteArray())
    }

    @Test
    fun `requireFek throws MissingKeyException when absent`() {
        val file = TestClips.buildEncrypted(dir, "clip.mp4", plaintext)
        val h = EncryptionDetector().headerFor(file)!!
        val emptyStore = TeslaKeyStore(dir.toString()) // fresh instance, no keys persisted under this key
        val svc = EncryptedMediaService(EncryptionDetector(), emptyStore)
        assertThrows(EncryptedMediaService.MissingKeyException::class.java) { svc.requireFek(h) }
    }
}
```

`backend/src/test/kotlin/dev/teslacam/api/MediaControllerEncryptTest.kt`:

```kotlin
package dev.teslacam.api

import dev.teslacam.encrypt.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.web.context.WebApplicationContext
import java.nio.file.Files
import java.nio.file.Path

/**
 * Full-context test with teslacam.root pointed at a temp dir (set via
 * @SpringBootTest properties below). Verifies plain regression + encrypted serving.
 */
@SpringBootTest(properties = ["teslacam.root=REPLACED_IN_SETUP"])
class MediaControllerEncryptTest {
    companion object { @TempDir static var root: Path = null } // see note below

    // Implementer note: JUnit @TempDir cannot be static-initialized like this in Kotlin;
    // use a @TempDir companion via @JvmStatic or a manually created
    // Files.createTempDirectory in @BeforeAll, and set the property through
    // @DirtiesContext + DynamicPropertySource, or construct MediaController manually
    // with MockMvcBuilders.standaloneSetup(MediaController(root, detector, mediaService)).

    // Preferred concrete setup (no Spring context):
    private lateinit var mockMvc: MockMvc
    private lateinit var root: Path

    @BeforeEach
    fun setup() {
        root = Files.createTempDirectory("tcroot")
        val detector = EncryptionDetector()
        val keyStore = TeslaKeyStore(root.toString())
        val svc = EncryptedMediaService(detector, keyStore)
        mockMvc = MockMvcBuilders.standaloneSetup(
            MediaController(root.toString(), detector, keyStore, svc)
        ).build()
        Files.createDirectories(root.resolve("RecentClips/2024-01-01_00-00-00"))
    }

    // Tests: plain 200 regression, encrypted full GET, ranges, 416, 409 missing_key,
    // 409 for Range request without key. See step 1 checklist in the task body.
}
```

*(The full-context variant above is optional; the standalone-setup path is the reliable one — construct `MediaController` directly with a temp root, real detector/store/service, and exercise the cases listed: plain 200 byte-identical; encrypted full GET byte-identical; `bytes=0-4095` → 206 with `Content-Range: bytes 0-4095/<size>`; `bytes=5000-` → 206 tail; `bytes=-100` → 206 last 100 bytes; `bytes=999999-` → 416 with `Content-Range: bytes */<size>`; encrypted without FEK → 409 `{"error":"missing_key"}`.)*

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./gradlew test --tests "dev.teslacam.encrypt.EncryptedMediaServiceTest"`
Expected: compilation FAIL.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/dev/teslacam/encrypt/EncryptedMediaService.kt`:

```kotlin
package dev.teslacam.encrypt

import org.springframework.stereotype.Component
import java.io.OutputStream
import java.io.RandomAccessFile
import java.nio.file.Path
import java.util.Base64

@Component
class EncryptedMediaService(
    private val detector: EncryptionDetector,
    private val keyStore: TeslaKeyStore,
) {
    class MissingKeyException(val storeKey: String) : RuntimeException("no FEK stored for $storeKey")

    fun requireFek(header: EcryptfsHeader): ByteArray {
        val b64 = keyStore.get(header.storeKey)
            ?: throw MissingKeyException(header.storeKey)
        val fek = runCatching { Base64.getDecoder().decode(b64) }.getOrNull()
        if (fek == null || fek.size != 16) throw MissingKeyException(header.storeKey)
        return fek
    }

    /** Writes plaintext bytes [start..endInclusive]; caller clamps end ≤ plaintextSize−1. */
    fun writeRange(
        path: Path, header: EcryptfsHeader, fek: ByteArray,
        start: Long, endInclusive: Long, out: OutputStream,
    ) {
        val dec = PageDecryptor(fek)
        RandomAccessFile(path.toFile(), "r").use { raf ->
            var page = (start / EcryptfsHeaderReader.PAGE_SIZE).toInt()
            var remaining = endInclusive - start + 1
            while (remaining > 0) {
                raf.seek(EcryptfsHeaderReader.HEADER_SIZE + page.toLong() * EcryptfsHeaderReader.PAGE_SIZE)
                val pageBuf = ByteArray(EcryptfsHeaderReader.PAGE_SIZE)
                raf.readFully(pageBuf)
                val pt = dec.decryptPage(pageBuf, page)
                val pageStart = page.toLong() * EcryptfsHeaderReader.PAGE_SIZE
                val from = (start - pageStart).coerceAtLeast(0).toInt()
                val to = (endInclusive - pageStart).coerceAtMost(EcryptfsHeaderReader.PAGE_SIZE - 1L).toInt()
                out.write(pt, from, to - from + 1)
                remaining -= (to - from + 1)
                page++
            }
        }
    }
}
```

**MediaController changes** — constructor gains detector/keyStore/service; plain path untouched; new encrypted branch:

```kotlin
@RestController
class MediaController(
    @Value("\${teslacam.root}") private val root: String,
    private val detector: dev.teslacam.encrypt.EncryptionDetector,
    private val keyStore: dev.teslacam.encrypt.TeslaKeyStore,
    private val encryptedMedia: dev.teslacam.encrypt.EncryptedMediaService,
) {
    // media(): after safePath + contentType computation:
    //   val header = detector.headerFor(path)
    //   return if (header == null) plain(path, contentType) else encrypted(path, header, contentType, request)

    private fun encrypted(
        path: Path, header: dev.teslacam.encrypt.EcryptfsHeader,
        contentType: MediaType, request: jakarta.servlet.http.HttpServletRequest,
    ): ResponseEntity<org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody> {
        val fek = try {
            encryptedMedia.requireFek(header)
        } catch (_: dev.teslacam.encrypt.EncryptedMediaService.MissingKeyException) {
            return ResponseEntity.status(409).contentType(MediaType.APPLICATION_JSON)
                .body(org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody {
                    it.write("""{"error":"missing_key"}""".toByteArray())
                })
        }
        val size = header.plaintextSize
        val rangeHeader = request.getHeader("Range")?.trim()
        if (rangeHeader.isNullOrEmpty()) {
            return ResponseEntity.ok()
                .contentType(contentType)
                .header("Accept-Ranges", "bytes")
                .contentLength(size)
                .body(org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody { out ->
                    encryptedMedia.writeRange(path, header, fek, 0, size - 1, out)
                })
        }
        val m = Regex("""^bytes=(\d*)-(\d*)$""").matchEntire(rangeHeader)
        // Multiple ranges or malformed → serve full 200 (RFC allows ignoring Range).
        if (m == null || (m.groupValues[1].isEmpty() && m.groupValues[2].isEmpty())) {
            return fullEncrypted(path, header, fek, contentType)
        }
        val (start, end) = if (m.groupValues[1].isEmpty()) {
            // suffix "-N": last N bytes
            val n = m.groupValues[2].toLong().coerceAtLeast(1)
            (size - n).coerceAtLeast(0) to (size - 1)
        } else {
            val s = m.groupValues[1].toLong()
            val e = if (m.groupValues[2].isEmpty()) size - 1 else m.groupValues[2].toLong().coerceAtMost(size - 1)
            s to e
        }
        if (start >= size || start > end) {
            return ResponseEntity.status(416)
                .header("Content-Range", "bytes */$size")
                .contentType(MediaType.APPLICATION_JSON)
                .body(org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody {
                    it.write("""{"error":"range_not_satisfiable"}""".toByteArray())
                })
        }
        return ResponseEntity.status(206)
            .contentType(contentType)
            .header("Accept-Ranges", "bytes")
            .header("Content-Range", "bytes $start-$end/$size")
            .contentLength(end - start + 1)
            .body(org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody { out ->
                encryptedMedia.writeRange(path, header, fek, start, end, out)
            })
    }

    private fun fullEncrypted(
        path: Path, header: dev.teslacam.encrypt.EcryptfsHeader,
        fek: ByteArray, contentType: MediaType,
    ): ResponseEntity<org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody> {
        val size = header.plaintextSize
        return ResponseEntity.ok()
            .contentType(contentType)
            .header("Accept-Ranges", "bytes")
            .contentLength(size)
            .body(org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody { out ->
                encryptedMedia.writeRange(path, header, fek, 0, size - 1, out)
            })
    }

    private fun missingKey(): Nothing = throw IllegalStateException("unreachable")
}
```

(Implementer: use imports instead of fully-qualified names; `missingKey` placeholder is not needed — remove it. The plain path (`plain(...)`) is the existing method body extracted unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./gradlew test`
Expected: PASS (full suite — includes existing MediaController tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/kotlin/dev/teslacam/encrypt/EncryptedMediaService.kt \
        backend/src/main/kotlin/dev/teslacam/api/MediaController.kt \
        backend/src/test/kotlin/dev/teslacam/encrypt/EncryptedMediaServiceTest.kt \
        backend/src/test/kotlin/dev/teslacam/api/MediaControllerEncryptTest.kt
git commit -m "feat(media): decrypt eCryptfs clips on the fly with Range support"
```

---

### Task 7: Events API — encrypted flags + key items; keys endpoints

**Files:**
- Modify: `backend/src/main/kotlin/dev/teslacam/scanner/EventScanner.kt`
- Modify: `backend/src/main/kotlin/dev/teslacam/api/EventsController.kt`
- Create: `backend/src/main/kotlin/dev/teslacam/api/KeysController.kt`
- Modify: `backend/src/main/kotlin/dev/teslacam/WebConfig.kt` (CORS headers)
- Test: `backend/src/test/kotlin/dev/teslacam/api/KeysControllerTest.kt`

**Interfaces:**
- Consumes: `EncryptionDetector` (Task 1), `KeyItem`/`TeslaKeyClient` (Task 4), `TeslaKeyStore` (Task 3).
- Produces:
  - `EventSummary.encrypted: Boolean` → `EventSummaryDto.encrypted`
  - `SegmentInfo(encrypted: Boolean, keyItem: KeyItem?)` — added fields; `keyItem.id` = root-relative path with `/` separators.
  - `POST /api/keys/fetch` body `{"items":[KeyItem...]}` → `{results:[{id,status}], fetched}` (status ∈ `fetched|no_key|failed`); items already in store short-circuit to `fetched`. Header `Authorization: Bearer <token>` is forwarded to Tesla.
  - `GET /api/keys` → `{keyCount: Int}`
  - CORS `/api/**` gains `.allowedHeaders("Authorization", "Content-Type")`.

- [ ] **EventScanner changes**

Constructor: add `private val detector: EncryptionDetector`.

In `summarize()`:
```kotlin
val encrypted = segments.any { detector.headerFor(it.file) != null }
// EventSummary(..., encrypted = encrypted)
```

In `detail()`'s `mapValues` mapping, per segment:
```kotlin
val header = detector.headerFor(seg.file)
SegmentInfo(
    camera = seg.camera,
    start = seg.start,
    url = "/media/$category/$folder/${seg.file.fileName}",
    playable = seg.bytes > 0,
    // Encrypted files keep moov encrypted → the mvhd tail parse is garbage; estimate.
    estimatedSeconds = if (header != null) maxOf(1.0, (seg.bytes - 8192) / BYTES_PER_SECOND)
                       else maxOf(1.0, seg.durationSeconds ?: seg.bytes / BYTES_PER_SECOND),
    encrypted = header != null,
    keyItem = header?.let {
        KeyItem(
            id = Path.of(root).toAbsolutePath().normalize()
                .relativize(seg.file.toAbsolutePath().normalize()).toString().replace('\\', '/'),
            vin = it.vin,
            keyId = it.keyId,
            timestamp = it.timestamp,
            wrappedKey = it.wrappedKeyB64,
            publicKey = it.publicKeyB64,
        )
    },
)
```

Data class updates:
```kotlin
data class SegmentInfo(
    val camera: String, val start: LocalDateTime, val url: String,
    val playable: Boolean, val estimatedSeconds: Double,
    val encrypted: Boolean,
    val keyItem: dev.teslacam.encrypt.KeyItem?,
)

data class EventSummary(
    /* existing fields */ val encrypted: Boolean,
)
```

`EventsController.toDto()`: pass `encrypted = encrypted` through to `EventSummaryDto` (add field).

- [ ] **KeysController**

`backend/src/main/kotlin/dev/teslacam/api/KeysController.kt`:

```kotlin
package dev.teslacam.api

import dev.teslacam.encrypt.*
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

data class FetchKeysRequest(val items: List<KeyItem> = emptyList())

@RestController
@RequestMapping("/api/keys")
class KeysController(
    private val keyClient: TeslaKeyClient,
    private val keyStore: TeslaKeyStore,
    @org.springframework.beans.factory.annotation.Value("\${teslacam.root}") private val root: String,
) {
    @org.springframework.web.bind.annotation.GetMapping
    fun status(): Map<String, Int> = mapOf("keyCount" to keyStore.size())

    @PostMapping("/fetch")
    fun fetch(
        @org.springframework.web.bind.annotation.RequestBody body: FetchKeysRequest,
        @org.springframework.web.bind.annotation.RequestHeader("Authorization", required = false) authorization: String?,
    ): ResponseEntity<Any> {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        if (token.isNullOrEmpty()) return ResponseEntity.status(401).body(mapOf("error" to "not_logged_in"))
        val results = mutableListOf<Map<String, String>>()
        var fetched = 0
        val missing = mutableListOf<KeyItem>()
        for (item in body.items) {
            if (keyStore.get(item.storeKey) != null) {
                results += mapOf("id" to item.id, "status" to "fetched"); fetched++
            } else missing += item
        }
        if (missing.isNotEmpty()) {
            val byId = missing.associateBy { it.id }
            val keys = try {
                keyClient.fetchKeys(missing, token)
            } catch (e: TeslaKeyException) {
                missing.forEach { results += mapOf("id" to it.id, "status" to "failed") }
                return ResponseEntity.ok(mapOf("results" to results, "fetched" to fetched))
            }
            // Persist keyed by storeKey so playback can look up without path knowledge.
            val byStoreKey = keys.mapNotNull { (id, fek) ->
                missing.find { it.id == id }?.let { it.storeKey to fek }
            }.toMap()
            keyStore.putAll(byStoreKey)
            for (item in missing) {
                val status = if (keys.containsKey(item.id)) "fetched" else "no_key"
                if (status == "fetched") fetched++
                results += mapOf("id" to item.id, "status" to status)
            }
        }
        return ResponseEntity.ok(mapOf("results" to results, "fetched" to fetched))
    }
}
```

- [ ] **CORS change in WebConfig.kt**

```kotlin
registry.addMapping("/api/**")
    .allowedOrigins("http://localhost:5173")
    .allowedMethods("GET", "POST")
    .allowedHeaders("Authorization", "Content-Type")
```

- [ ] **KeysControllerTest** (standalone MockMvc, mockk `TeslaKeyClient`)

Cases: no Authorization header → 401; cached item short-circuits (`keyStore.putAll` first, mockk client `verify { fetchKeys wasNot Called }`); Tesla returns key → 200 `fetched` + store now has FEK (`keyStore.get(storeKey) != null`); Tesla omits key → `no_key`; `AkamaiChallenge` thrown → all `failed`, still HTTP 200.

- [ ] **Run full backend suite → PASS → Commit**

```bash
git add backend/src/main/kotlin/dev/teslacam/scanner/EventScanner.kt \
        backend/src/main/kotlin/dev/teslacam/api/EventsController.kt \
        backend/src/main/kotlin/dev/teslacam/api/KeysController.kt \
        backend/src/main/kotlin/dev/teslacam/WebConfig.kt \
        backend/src/test/kotlin/dev/teslacam/api/KeysControllerTest.kt
git commit -m "feat(api): expose encrypted flags + key items; keys fetch and status endpoints"
```

---

### Task 8: Frontend API client + Tesla auth module

**Files:**
- Modify: `frontend/src/api/client.ts`
- Create: `frontend/src/tesla/teslaAuth.ts`
- Test: `frontend/src/tesla/teslaAuth.test.ts`

**Interfaces:**
- Consumes: backend endpoints from Tasks 5 and 7.
- Produces:
  - In `client.ts`: `KeyItemDto { id: string; vin: string; keyId: number; timestamp: number; wrappedKey: string; publicKey: string }`; `SegmentDto` gains `encrypted: boolean; keyItem: KeyItemDto | null`; `EventSummaryDto` gains `encrypted: boolean`.
  - `interface TeslaTokens { accessToken: string; refreshToken: string; expiresAt: number }`
  - `loadTokens(): TeslaTokens | null`, `saveTokens(t)`, `clearTokens()` — localStorage key `tesla.tokens`.
  - `getValidAccessToken(): Promise<string | null>` — returns cached access token; refreshes via `/api/tesla/refresh` when `Date.now() >= expiresAt`; clears tokens on refresh failure and returns null.
  - `exchangeCode(code: string, verifier: string): Promise<TeslaTokens>` — POST `/api/tesla/token`; throws on non-OK.
  - `fetchKeys(items: KeyItemDto[]): Promise<{ results: { id: string; status: string }[]; fetched: number }>` — POST `/api/keys/fetch` with `Authorization: Bearer <getValidAccessToken()>`; throws `Error('not_logged_in')` when no token.
  - In `teslaAuth.ts`: `AUTHORIZE_URL` = `https://auth.tesla.com/oauth2/v3/authorize`; `buildAuthorizeUrl(challenge: string, state: string): string` — `?client_id=dashcam&response_type=code&redirect_uri=https%3A%2F%2Fdashcam.tesla.com%2Fcallback&scope=openid%20profile%20email%20offline_access&code_challenge=<challenge>&code_challenge_method=S256&state=<state>`; `parseCallbackUrl(url: string): { code: string; state: string } | null` (null when no `code` param); `startLogin(): Promise<void>` — GET `/api/tesla/pkce`, save `{verifier, state}` under `tesla.pkce`, `window.open(buildAuthorizeUrl(...), '_blank')`; `takePkce() / clearPkce()`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/tesla/teslaAuth.test.ts` — mock global `fetch` and `window.open`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildAuthorizeUrl, parseCallbackUrl } from './teslaAuth'

describe('buildAuthorizeUrl', () => {
  it('includes client_id, redirect_uri, S256 challenge and state', () => {
    const url = buildAuthorizeUrl('challenge123', 'state456')
    expect(url.startsWith('https://auth.tesla.com/oauth2/v3/authorize?')).toBe(true)
    expect(url).toContain('client_id=dashcam')
    expect(url).toContain('redirect_uri=https%3A%2F%2Fdashcam.tesla.com%2Fcallback')
    expect(url).toContain('code_challenge=challenge123')
    expect(url).toContain('code_challenge_method=S256')
    expect(url).toContain('state=state456')
    expect(url).toContain('scope=openid')
  })
})

describe('parseCallbackUrl', () => {
  it('extracts code and state', () => {
    const out = parseCallbackUrl('https://dashcam.tesla.com/callback?code=abc&state=xyz')
    expect(out).toEqual({ code: 'abc', state: 'xyz' })
  })
  it('returns null when code missing', () => {
    expect(parseCallbackUrl('https://dashcam.tesla.com/callback?state=xyz')).toBeNull()
  })
  it('returns null for garbage input', () => {
    expect(parseCallbackUrl('not a url')).toBeNull()
  })
})
```

Plus client.ts token-storage tests (create `frontend/src/api/client.test.ts` if absent; mock `localStorage` — vitest jsdom environment provides it): `loadTokens` returns null when unset; `saveTokens`/`loadTokens` round-trip; `clearTokens` removes.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- --run`
Expected: FAIL — modules/functions missing.

- [ ] **Step 3: Implement**

`client.ts` additions:

```typescript
export interface KeyItemDto {
  id: string
  vin: string
  keyId: number
  timestamp: number
  wrappedKey: string
  publicKey: string
}

export interface TeslaTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

const TOKENS_KEY = 'tesla.tokens'

export function loadTokens(): TeslaTokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY)
    return raw == null ? null : (JSON.parse(raw) as TeslaTokens)
  } catch {
    return null
  }
}

export function saveTokens(t: TeslaTokens): void {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(t))
}

export function clearTokens(): void {
  localStorage.removeItem(TOKENS_KEY)
}

export async function refreshTokens(): Promise<TeslaTokens | null> {
  const tokens = loadTokens()
  if (tokens == null) return null
  const res = await fetch('/api/tesla/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  })
  if (!res.ok) {
    clearTokens()
    return null
  }
  const fresh = (await res.json()) as TeslaTokens
  saveTokens(fresh)
  return fresh
}

export async function getValidAccessToken(): Promise<string | null> {
  const tokens = loadTokens()
  if (tokens == null) return null
  if (Date.now() < tokens.expiresAt) return tokens.accessToken
  const fresh = await refreshTokens()
  return fresh?.accessToken ?? null
}

export async function exchangeCode(code: string, verifier: string): Promise<TeslaTokens> {
  const res = await fetch('/api/tesla/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, verifier }),
  })
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}`)
  return (await res.json()) as TeslaTokens
}

export interface FetchKeysResult {
  results: { id: string; status: string }[]
  fetched: number
}

export async function fetchKeys(items: KeyItemDto[]): Promise<FetchKeysResult> {
  const token = await getValidAccessToken()
  if (token == null) throw new Error('not_logged_in')
  const res = await fetch('/api/keys/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ items }),
  })
  if (!res.ok) throw new Error(`key fetch failed: HTTP ${res.status}`)
  return (await res.json()) as FetchKeysResult
}
```

`SegmentDto` gains `encrypted: boolean` and `keyItem: KeyItemDto | null`; `EventSummaryDto` gains `encrypted: boolean`.

`frontend/src/tesla/teslaAuth.ts`:

```typescript
import { exchangeCode } from '../api/client'

export const AUTHORIZE_URL = 'https://auth.tesla.com/oauth2/v3/authorize'
export const CLIENT_ID = 'dashcam'
export const REDIRECT_URI = 'https://dashcam.tesla.com/callback'
export const SCOPES = 'openid profile email offline_access'

const PKCE_KEY = 'tesla.pkce'

export interface PkcePending {
  verifier: string
  state: string
}

export function buildAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

export function parseCallbackUrl(url: string): { code: string; state: string } | null {
  try {
    const u = new URL(url.trim())
    const code = u.searchParams.get('code')
    if (code == null || code === '') return null
    return { code, state: u.searchParams.get('state') ?? '' }
  } catch {
    return null
  }
}

export async function startLogin(): Promise<void> {
  const res = await fetch('/api/tesla/pkce')
  if (!res.ok) throw new Error(`pkce mint failed: HTTP ${res.status}`)
  const pkce = (await res.json()) as { verifier: string; challenge: string; state: string }
  localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier: pkce.verifier, state: pkce.state }))
  window.open(buildAuthorizeUrl(pkce.challenge, pkce.state), '_blank')
}

export function takePkce(): { verifier: string; state: string } | null {
  try {
    const raw = localStorage.getItem(PKCE_KEY)
    if (raw == null) return null
    localStorage.removeItem(PKCE_KEY)
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function completeLogin(pastedUrl: string): Promise<void> {
  const parsed = parseCallbackUrl(pastedUrl)
  if (parsed == null) return Promise.reject(new Error('No authorization code in pasted URL'))
  const pkce = takePkce()
  if (pkce == null) return Promise.reject(new Error('No pending login — start the login first'))
  if (pkce.state !== parsed.state) return Promise.reject(new Error('State mismatch — paste the URL from the same login attempt'))
  return exchangeCode(parsed.code, pkce.verifier).then(() => undefined)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.test.ts \
        frontend/src/tesla/teslaAuth.ts frontend/src/tesla/teslaAuth.test.ts
git commit -m "feat(frontend): Tesla auth module + API client extensions for encrypted clips"
```

---

### Task 9: Tesla login UI

**Files:**
- Create: `frontend/src/tesla/TeslaLoginDialog.tsx`
- Create: `frontend/src/tesla/useTeslaAuth.ts`
- Modify: `frontend/src/views/EventList.tsx` (AppBar button + dialog)
- Test: `frontend/src/tesla/useTeslaAuth.test.tsx`

**Interfaces:**
- Consumes: `teslaAuth.ts` + `client.ts` token functions (Task 8).
- Produces:
  - `useTeslaAuth(): { loggedIn: boolean; busy: boolean; error: string | null; start(): Promise<void>; confirm(pastedUrl: string): Promise<void>; logout(): void }`
    - `start()` → `startLogin()`, state `awaiting`
    - `confirm(pastedUrl)` → `completeLogin` → re-read tokens → `loggedIn=true`
    - `loggedIn` derived from `loadTokens() != null`
    - `logout()` → `clearTokens()`
  - `TeslaLoginDialog({ open, onClose }: { open: boolean; onClose: () => void })` — MUI Dialog: step 1 "Login with Tesla" button + explanation that the redirect page will show Tesla's "page not found" and the URL must be copied from the address bar; step 2 TextField for the pasted URL + Confirm button; Alert for errors; LinearProgress while exchanging.
  - EventList AppBar: when logged out — `Button startIcon={<LoginIcon/>} label "Tesla"`; when logged in — `Chip icon={<KeyIcon/>} label "Tesla" deleteIcon={<LogoutIcon/>}` with onDelete = logout. Dialog opens from either.

- [ ] **Step 1: Write the failing test** — `useTeslaAuth.test.ts`: mock `./teslaAuth` + `../api/client` with vi.mock; cases: `confirm` with valid URL calls completeLogin and sets loggedIn; `confirm` with garbage URL sets error and stays logged out; state mismatch surfaces error message. Render with `@testing-library/react` `renderHook`.

- [ ] **Step 2: Run → FAIL → implement hook + dialog → run → PASS**

- [ ] **Step 3: Commit**

```bash
git add frontend/src/tesla/TeslaLoginDialog.tsx frontend/src/tesla/useTeslaAuth.ts \
        frontend/src/tesla/useTeslaAuth.test.ts frontend/src/views/EventList.tsx
git commit -m "feat(frontend): Tesla login dialog + status in header"
```

---

### Task 10: Player key-fetch gate + lock icons + docs

**Files:**
- Create: `frontend/src/tesla/EncryptionGate.tsx`
- Modify: `frontend/src/views/Player.tsx` (wrap CameraGrid)
- Modify: `frontend/src/views/EventList.tsx` (lock Chip on encrypted events)
- Modify: `README.md` ("Encrypted clips" section)
- Test: `frontend/src/tesla/EncryptionGate.test.tsx`

**Interfaces:**
- Consumes: `SegmentDto.keyItem` (Task 7/8), `fetchKeys`, token functions (Task 8).
- Produces:
  - `EncryptionGate({ detail, children }: { detail: EventDetailDto; children: ReactNode })`:
    - No encrypted segments → render children immediately.
    - Encrypted present: dedupe `keyItem`s by `vin:keyId:timestamp` (distinct store keys) → run flow:
      1. `getValidAccessToken()` null → render login prompt (MUI Alert + Button that opens `TeslaLoginDialog`); after successful login, retry automatically (listen via a `loggedIn` prop or re-run on dialog close).
      2. Token present → `fetchKeys(items)`; while fetching show LinearProgress; on success render children.
      3. Partial: any `no_key` results → still render children + Alert "N clips could not be decrypted — Tesla returned no key for them".
      4. `fetchKeys` throws (Akamai/network/401) → Alert with the error + Retry button; 401 (`not_logged_in`) behaves like step 1.
  - EventList: `{e.encrypted && <Chip size="small" icon={<LockIcon/>} label="encrypted" />}` next to the camera chip.
  - Player.tsx: wrap `<CameraGrid .../>` in `<EncryptionGate detail={detail}>` (CameraGrid keeps all existing props inside the children render).

- [ ] **Step 1: Failing test** — `EncryptionGate.test.tsx` (mock `fetchKeys` + token helpers): no encrypted segments → children render without any fetch call; encrypted + no token → login prompt shown, no fetch; encrypted + token + all fetched → children render after fetch resolves; `no_key` result → children + warning Alert.

- [ ] **Step 2: Run → FAIL → implement gate + Player/EventList wiring → run → PASS**

- [ ] **Step 3: Full frontend test run + build**

Run: `cd frontend && npm test -- --run && npm run build`
Expected: PASS.

- [ ] **Step 4: README section** (append under an appropriate existing heading):

```markdown
## Encrypted clips

Firmware 2026.20+ can encrypt Dashcam/Sentry clips. To play them:

1. Click **Tesla** in the header and log in with your Tesla account (popup).
2. Tesla redirects to a page that will not load — copy the full URL from the
   browser address bar and paste it back into the dialog.
3. Open an encrypted event (marked with a lock icon). Keys are fetched from
   your Tesla account automatically and cached server-side in
   `.teslacam_keys.json` next to your footage.

Caveats:
- The Tesla token lives in your browser's localStorage; log out clears it.
- Key requests to Tesla may occasionally be blocked (HTTP 403, Akamai). Retry
  later if that happens.
- Decryption happens on the fly; unencrypted clips are unaffected.
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/tesla/EncryptionGate.tsx frontend/src/tesla/EncryptionGate.test.tsx \
        frontend/src/views/Player.tsx frontend/src/views/EventList.tsx README.md
git commit -m "feat(frontend): key-fetch gate for encrypted events + lock icons + docs"
```

---

## Verification (final)

- [ ] `cd backend && ./gradlew test` — full suite green.
- [ ] `cd frontend && npm test -- --run && npm run build` — green.
- [ ] Manual smoke with a real encrypted clip (if available): boot backend + frontend, open encrypted event, complete login flow, confirm playback and seek/Range behavior.
- [ ] **Real-clip validation checkpoint:** the page-IV scheme was confirmed against the reference implementation's source (`_derive_iv` verbatim). If a real encrypted clip decrypts to garbage, stop and diff the production decrypt path against `ecryptfs.py` byte-for-byte before changing anything else.

## Self-review notes

- Spec coverage: header parsing (Task 1), page decrypt (Task 2), FEK store (Task 3), batch client (Task 4), auth (Task 5), Range streaming (Task 6), API flags + keys endpoints (Task 7), frontend auth + keys (Tasks 8-10), README (Task 10).
- Bookmarklet fallback: out of scope per spec.
- `SegmentDto.playable` semantics unchanged; no-key encrypted segments surface backend 409 as video errors — acceptable per spec ("other cameras keep playing").