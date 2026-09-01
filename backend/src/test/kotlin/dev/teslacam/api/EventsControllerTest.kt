// backend/src/test/kotlin/dev/teslacam/api/EventsControllerTest.kt
package dev.teslacam.api

import dev.teslacam.scanner.*
import io.mockk.every
import io.mockk.mockk
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*
import java.time.LocalDateTime

@WebMvcTest(EventsController::class)
class EventsControllerTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var service: EventIndexService  // the @Bean from Cfg below (a MockK)

    private val sample = EventSummary(
        category = "SentryClips", folder = "2026-07-10_17-21-39",
        folderTimestamp = LocalDateTime.of(2026, 7, 10, 17, 21, 39),
        metadata = EventMetadata(
            timestamp = LocalDateTime.of(2026, 7, 10, 17, 20, 19),
            city = "Grefrath", street = "Flugplatz",
            lat = 51.3352, lon = 6.35791,
            reason = "sentry_aware_object_detection", cameraIndex = 5,
        ),
        cameraName = "right_pillar", segmentCount = 12, playable = true, encrypted = true,
    )

    @TestConfiguration
    class Cfg {
        @Bean
        fun indexService(): EventIndexService = mockk(relaxed = true)
    }

    @BeforeEach
    fun stubDefaults() {
        every { service.list("SentryClips") } returns listOf(sample)
        every { service.list("RecentClips") } returns emptyList()
        every { service.list("SavedClips") } returns emptyList()
        every { service.list("HackedClips") } returns null
        every { service.detail(any(), any()) } returns null
        every { service.refresh() } returns mapOf("SentryClips" to listOf(sample))
    }

    @Test
    fun `lists events with flat fields`() {
        mvc.perform(get("/api/events/SentryClips"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$[0].folder").value("2026-07-10_17-21-39"))
            .andExpect(jsonPath("$[0].city").value("Grefrath"))
            .andExpect(jsonPath("$[0].camera").value("right_pillar"))
            .andExpect(jsonPath("$[0].timestamp").value("2026-07-10T17:20:19"))
            .andExpect(jsonPath("$[0].encrypted").value(true))
    }

    @Test
    fun `unknown category is 404`() {
        mvc.perform(get("/api/events/HackedClips")).andExpect(status().isNotFound)
    }

    @Test
    fun `empty category returns empty array`() {
        mvc.perform(get("/api/events/RecentClips"))
            .andExpect(status().isOk)
            .andExpect(content().json("[]"))
    }

    @Test
    fun `detail returns timeline and segments`() {
        val seg = SegmentInfo("front", LocalDateTime.of(2026, 7, 10, 17, 19, 23),
            "/media/SentryClips/2026-07-10_17-21-39/2026-07-10_17-19-23-front.mp4", true, 60.0,
            encrypted = true, keyItem = null)
        every { service.detail("SentryClips", "2026-07-10_17-21-39") } returns EventDetail(
            summary = sample,
            segmentsByCamera = mapOf("front" to listOf(seg), "back" to emptyList()),
            timeline = TimelineInfo(LocalDateTime.of(2026, 7, 10, 17, 19, 23), LocalDateTime.of(2026, 7, 10, 17, 21, 30)),
        )
        mvc.perform(get("/api/events/SentryClips/2026-07-10_17-21-39"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.timeline.start").value("2026-07-10T17:19:23"))
            .andExpect(jsonPath("$.segmentsByCamera.front[0].url").value("/media/SentryClips/2026-07-10_17-21-39/2026-07-10_17-19-23-front.mp4"))
            .andExpect(jsonPath("$.summary.city").value("Grefrath"))
    }

    @Test
    fun `detail 404 for unknown folder`() {
        mvc.perform(get("/api/events/SentryClips/nope")).andExpect(status().isNotFound)
    }

    @Test
    fun `refresh endpoint returns ok`() {
        mvc.perform(post("/api/refresh")).andExpect(status().isOk)
    }

    @Test
    fun `refresh returns new index stats`() {
        every { service.refresh() } returns mapOf(
            "RecentClips" to emptyList(),
            "SavedClips" to listOf(sample),
            "SentryClips" to listOf(sample, sample),
        )
        mvc.perform(post("/api/refresh"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.RecentClips").value(0))
            .andExpect(jsonPath("$.SavedClips").value(1))
            .andExpect(jsonPath("$.SentryClips").value(2))
    }
}
