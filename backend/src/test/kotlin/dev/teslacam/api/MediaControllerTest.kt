package dev.teslacam.api

import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.web.context.WebApplicationContext
import java.nio.file.Files
import java.nio.file.Path

@SpringBootTest
@TestPropertySource(properties = ["teslacam.root=\${java.io.tmpdir}/tcv-media-test-root"])
class MediaControllerTest {
    @Autowired lateinit var ctx: WebApplicationContext
    lateinit var root: Path
    lateinit var mvc: MockMvc

    private val payload = ByteArray(1000) { (it % 256).toByte() }

    @BeforeEach
    fun setup() {
        root = Path.of(System.getProperty("java.io.tmpdir")).resolve("tcv-media-test-root")
        val dir = root.resolve("SentryClips").resolve("2026-07-10_17-21-39")
        Files.createDirectories(dir)
        Files.write(dir.resolve("2026-07-10_17-19-23-front.mp4"), payload)
        Files.write(dir.resolve("thumb.png"), ByteArray(32))
        mvc = MockMvcBuilders.webAppContextSetup(ctx).build()
        // wipe test root at class teardown not needed: same content every run
    }

    @Test
    fun `full file 200 with correct content type and accept-ranges`() {
        mvc.perform(get("/media/SentryClips/2026-07-10_17-21-39/2026-07-10_17-19-23-front.mp4"))
            .andExpect(status().isOk)
            .andExpect(content().contentType("video/mp4"))
            .andExpect(header().string("Accept-Ranges", "bytes"))
            .andExpect(content().bytes(payload))
    }

    @Test
    fun `range request returns 206 with content-range`() {
        mvc.perform(get("/media/SentryClips/2026-07-10_17-21-39/2026-07-10_17-19-23-front.mp4")
            .header("Range", "bytes=100-199"))
            .andExpect(status().isPartialContent)
            .andExpect(header().string("Content-Range", "bytes 100-199/1000"))
            .andExpect(content().bytes(payload.copyOfRange(100, 200)))
    }

    @Test
    fun `suffix range request`() {
        mvc.perform(get("/media/SentryClips/2026-07-10_17-21-39/2026-07-10_17-19-23-front.mp4")
            .header("Range", "bytes=-100"))
            .andExpect(status().isPartialContent)
            .andExpect(header().string("Content-Range", "bytes 900-999/1000"))
    }

    @Test
    fun `open-ended range request`() {
        mvc.perform(get("/media/SentryClips/2026-07-10_17-21-39/2026-07-10_17-19-23-front.mp4")
            .header("Range", "bytes=990-"))
            .andExpect(status().isPartialContent)
            .andExpect(header().string("Content-Range", "bytes 990-999/1000"))
    }

    @Test
    fun `unsatisfiable range is 416`() {
        mvc.perform(get("/media/SentryClips/2026-07-10_17-21-39/2026-07-10_17-19-23-front.mp4")
            .header("Range", "bytes=5000-"))
            .andExpect(status().isRequestedRangeNotSatisfiable)
    }

    @Test
    fun `thumb png is served as png`() {
        mvc.perform(get("/media/SentryClips/2026-07-10_17-21-39/thumb.png"))
            .andExpect(status().isOk)
            .andExpect(content().contentType("image/png"))
    }

    @Test
    fun `unknown category 404`() {
        mvc.perform(get("/media/HackedClips/2026-07-10_17-21-39/thumb.png"))
            .andExpect(status().isNotFound)
    }

    @Test
    fun `path traversal is 404`() {
        mvc.perform(get("/media/SentryClips/..%2F..%2Fetc/passwd"))
            .andExpect(status().isNotFound)
        mvc.perform(get("/media/SentryClips/2026-07-10_17-21-39/..%2F..%2F..%2Fapplication.yml"))
            .andExpect(status().isNotFound)
    }

    @Test
    fun `non-media filename 404`() {
        mvc.perform(get("/media/SentryClips/2026-07-10_17-21-39/event.json"))
            .andExpect(status().isNotFound)
    }
}