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