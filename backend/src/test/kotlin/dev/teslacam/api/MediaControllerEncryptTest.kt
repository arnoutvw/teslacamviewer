package dev.teslacam.api

import dev.teslacam.encrypt.EncryptedMediaService
import dev.teslacam.encrypt.EncryptionDetector
import dev.teslacam.encrypt.TestClips
import dev.teslacam.encrypt.TeslaKeyStore
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import java.nio.file.Files
import java.nio.file.Path

/**
 * Standalone MockMvc test with teslacam.root pointed at a temp dir: real
 * detector/keyStore/service, no Spring context. Verifies plain regression
 * (byte-identical) plus encrypted serving: full GET, ranges, 416, 409 missing_key.
 *
 * Encrypted responses are [StreamingResponseBody] bodies (async in MockMvc), so
 * every request goes through [getAndDispatch] which completes the async dispatch.
 * The plain path returns a PathResource (synchronous) and skips the dispatch.
 */
class MediaControllerEncryptTest {
    private lateinit var mockMvc: MockMvc
    private lateinit var root: Path

    private val plainPayload = ByteArray(1000) { (it % 256).toByte() }
    private val encryptedPayload = ByteArray(12_345) { (it % 256).toByte() }

    private val plainFile get() = "/media/RecentClips/2024-01-01_00-00-00/plain-front.mp4"
    private val encFile get() = "/media/RecentClips/2024-01-01_00-00-00/enc-front.mp4"
    private val encNoKeyFile get() = "/media/RecentClips/2024-01-01_00-00-00/enc-nokey-front.mp4"

    @BeforeEach
    fun setup() {
        root = Files.createTempDirectory("tcroot")
        val detector = EncryptionDetector()
        val keyStore = TeslaKeyStore(root.toString())
        keyStore.putAll(
            mapOf(
                "LRW3E7EK5MC000000:7:1700000000000" to
                    java.util.Base64.getEncoder().encodeToString(TestClips.fek())
            )
        )
        val svc = EncryptedMediaService(detector, keyStore)
        mockMvc = MockMvcBuilders.standaloneSetup(
            MediaController(root.toString(), detector, keyStore, svc)
        ).build()
        val dir = root.resolve("RecentClips/2024-01-01_00-00-00")
        Files.createDirectories(dir)
        Files.write(dir.resolve("plain-front.mp4"), plainPayload)
        TestClips.buildEncrypted(dir, "enc-front.mp4", encryptedPayload)
        // Different timestamp -> different storeKey -> no FEK persisted for it
        TestClips.buildEncrypted(dir, "enc-nokey-front.mp4", encryptedPayload, timestamp = 1_700_000_100_000L)
    }

    /** Performs the request and completes async processing if it was started. */
    private fun getAndDispatch(url: String, range: String? = null): MvcResult {
        val req = get(url)
        if (range != null) req.header("Range", range)
        val initial = mockMvc.perform(req).andReturn()
        return if (initial.request.isAsyncStarted) {
            mockMvc.perform(asyncDispatch(initial)).andReturn()
        } else {
            initial
        }
    }

    @Test
    fun `plain file regression - full 200 byte-identical`() {
        val r = getAndDispatch(plainFile)
        assertEquals(200, r.response.status)
        assertEquals("video/mp4", r.response.getHeader("Content-Type"))
        assertEquals("bytes", r.response.getHeader("Accept-Ranges"))
        assertArrayEquals(plainPayload, r.response.contentAsByteArray)
    }

    @Test
    fun `encrypted full GET returns exact plaintext`() {
        val r = getAndDispatch(encFile)
        assertEquals(200, r.response.status)
        assertEquals("video/mp4", r.response.getHeader("Content-Type"))
        assertEquals(encryptedPayload.size.toLong().toString(), r.response.getHeader("Content-Length"))
        assertEquals("bytes", r.response.getHeader("Accept-Ranges"))
        assertArrayEquals(encryptedPayload, r.response.contentAsByteArray)
    }

    @Test
    fun `encrypted single range 206 with content-range`() {
        val r = getAndDispatch(encFile, "bytes=0-4095")
        assertEquals(206, r.response.status)
        assertEquals("bytes 0-4095/12345", r.response.getHeader("Content-Range"))
        assertEquals(4096L, r.response.contentLengthLong)
        assertArrayEquals(encryptedPayload.copyOfRange(0, 4096), r.response.contentAsByteArray)
    }

    @Test
    fun `encrypted open-ended range 206 tail`() {
        val r = getAndDispatch(encFile, "bytes=5000-")
        assertEquals(206, r.response.status)
        assertEquals("bytes 5000-12344/12345", r.response.getHeader("Content-Range"))
        assertEquals(encryptedPayload.size - 5000L, r.response.contentLengthLong)
        assertArrayEquals(encryptedPayload.copyOfRange(5000, encryptedPayload.size), r.response.contentAsByteArray)
    }

    @Test
    fun `encrypted suffix range 206 last 100 bytes`() {
        val r = getAndDispatch(encFile, "bytes=-100")
        assertEquals(206, r.response.status)
        assertEquals("bytes 12245-12344/12345", r.response.getHeader("Content-Range"))
        assertEquals(100L, r.response.contentLengthLong)
        assertArrayEquals(encryptedPayload.copyOfRange(encryptedPayload.size - 100, encryptedPayload.size), r.response.contentAsByteArray)
    }

    @Test
    fun `encrypted unsatisfiable range 416 with content-range bytes-star`() {
        val r = getAndDispatch(encFile, "bytes=999999-")
        assertEquals(416, r.response.status)
        assertEquals("bytes */12345", r.response.getHeader("Content-Range"))
        assertEquals("""{"error":"range_not_satisfiable"}""", r.response.contentAsString)
    }

    @Test
    fun `encrypted without FEK returns 409 missing_key`() {
        val r = getAndDispatch(encNoKeyFile)
        assertEquals(409, r.response.status)
        assertEquals("""{"error":"missing_key"}""", r.response.contentAsString)
    }

    @Test
    fun `encrypted Range request without FEK also returns 409 missing_key`() {
        val r = getAndDispatch(encNoKeyFile, "bytes=0-1023")
        assertEquals(409, r.response.status)
        assertEquals("""{"error":"missing_key"}""", r.response.contentAsString)
    }

    @Test
    fun `encrypted unparseable Range is ignored - full 200`() {
        val r = getAndDispatch(encFile, "bytes=1-2-3")
        assertEquals(200, r.response.status)
        assertArrayEquals(encryptedPayload, r.response.contentAsByteArray)
    }
}