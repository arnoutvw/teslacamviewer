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
            writeInt(header, 16, 0x03000002L)
            writeInt(header, 20, PAGE_SIZE.toLong())
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