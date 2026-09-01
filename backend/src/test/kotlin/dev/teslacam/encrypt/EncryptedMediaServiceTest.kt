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