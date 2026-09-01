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