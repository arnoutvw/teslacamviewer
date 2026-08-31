// backend/src/main/kotlin/dev/teslacam/scanner/EventIndexService.kt
package dev.teslacam.scanner

import jakarta.annotation.PostConstruct
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.util.concurrent.atomic.AtomicReference

@Component
class EventIndexService(private val scanner: EventScanner) {
    private val log = LoggerFactory.getLogger(EventIndexService::class.java)
    private val index = AtomicReference<Map<String, List<EventSummary>>>(emptyMap())

    @PostConstruct
    fun refresh(): Map<String, List<EventSummary>> {
        try {
            index.set(scanner.scan())
        } catch (e: Exception) {
            log.warn("rescan failed, keeping previous index: {}", e.message)
        }
        return index.get()
    }

    @Scheduled(fixedDelay = 30_000)
    fun scheduledRefresh() { refresh() }

    fun list(category: String): List<EventSummary>? {
        if (category !in EventScanner.CATEGORIES) return null
        ensureScanned()
        return index.get()[category] ?: emptyList()
    }

    fun detail(category: String, folder: String): EventDetail? {
        if (category !in EventScanner.CATEGORIES) return null
        ensureScanned()
        return scanner.detail(category, folder)
    }

    private var scannedOnce = false
    @Synchronized
    private fun ensureScanned() {
        if (!scannedOnce) { scannedOnce = true; refresh() }
    }
}