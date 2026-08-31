// backend/src/test/kotlin/dev/teslacam/scanner/EventIndexServiceTest.kt
package dev.teslacam.scanner

import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.time.LocalDateTime

class EventIndexServiceTest {
    private val scanner: EventScanner = mockk()
    private val sample = EventSummary(
        category = "SentryClips", folder = "2026-07-10_17-21-39",
        folderTimestamp = LocalDateTime.of(2026, 7, 10, 17, 21, 39),
        metadata = null, cameraName = null, segmentCount = 6, playable = true,
    )

    @Test
    fun `list returns null for unknown category without scanning`() {
        every { scanner.scan() } returns emptyMap()
        val svc = EventIndexService(scanner)
        assertNull(svc.list("HackedClips"))
        verify(exactly = 0) { scanner.scan() } // unknown category rejected before any scan
    }

    @Test
    fun `list returns empty for known category with no events`() {
        every { scanner.scan() } returns mapOf("SavedClips" to emptyList())
        val svc = EventIndexService(scanner)
        assertEquals(emptyList<EventSummary>(), svc.list("SavedClips"))
    }

    @Test
    fun `list returns events and caches until refresh`() {
        every { scanner.scan() } returns mapOf("SentryClips" to listOf(sample))
        val svc = EventIndexService(scanner)
        assertEquals(listOf(sample), svc.list("SentryClips"))
        assertEquals(listOf(sample), svc.list("SentryClips"))
        verify(exactly = 1) { scanner.scan() }
        svc.refresh()
        verify(exactly = 2) { scanner.scan() }
    }

    @Test
    fun `scan failure keeps previous index`() {
        every { scanner.scan() } returns mapOf("SentryClips" to listOf(sample))
        val svc = EventIndexService(scanner)
        svc.list("SentryClips")
        every { scanner.scan() } throws RuntimeException("usb unplugged")
        svc.refresh()
        assertEquals(listOf(sample), svc.list("SentryClips"))
        every { scanner.scan() } returns mapOf("SentryClips" to listOf(sample))
        svc.refresh()
        assertEquals(listOf(sample), svc.list("SentryClips"))
    }

    @Test
    fun `failed initial refresh leaves empty index instead of throwing`() {
        every { scanner.scan() } throws RuntimeException("disk gone")
        val svc = EventIndexService(scanner)
        assertDoesNotThrow { svc.refresh() }
        assertEquals(emptyList<EventSummary>(), svc.list("SavedClips"))
    }

    @Test
    fun `delegates detail to scanner`() {
        every { scanner.detail("SentryClips", "2026-07-10_17-21-39") } returns null
        val svc = EventIndexService(scanner)
        assertNull(svc.detail("SentryClips", "2026-07-10_17-21-39"))
        verify(exactly = 1) { scanner.detail("SentryClips", "2026-07-10_17-21-39") }
    }
}