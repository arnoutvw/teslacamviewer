// backend/src/main/kotlin/dev/teslacam/api/EventsController.kt
package dev.teslacam.api

import dev.teslacam.scanner.*
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

data class EventSummaryDto(
    val category: String,
    val folder: String,
    val timestamp: String,      // metadata timestamp, else folder timestamp; ISO-8601
    val timestampSource: String, // "event" | "folder"
    val city: String?, val street: String?, val reason: String?,
    val lat: Double?, val lon: Double?,
    val camera: String?, val cameraIndex: Int?,
    val segmentCount: Int, val playable: Boolean,
)

@RestController
@RequestMapping("/api")
class EventsController(private val index: EventIndexService) {

    @GetMapping("/events/{category}")
    fun list(@PathVariable category: String): ResponseEntity<List<EventSummaryDto>> {
        val events = index.list(category) ?: return ResponseEntity.notFound().build()
        return ResponseEntity.ok(events.map { it.toDto() })
    }

    @GetMapping("/events/{category}/{folder}")
    fun detail(@PathVariable category: String, @PathVariable folder: String): ResponseEntity<Any> {
        val d = index.detail(category, folder) ?: return ResponseEntity.notFound().build<Any>()
        return ResponseEntity.ok(
            mapOf(
                "summary" to d.summary.toDto(),
                "segmentsByCamera" to d.segmentsByCamera,
                "timeline" to d.timeline,
            )
        )
    }

    @PostMapping("/refresh")
    fun refresh(): Map<String, Int> {
        val newIndex = index.refresh()
        return EventScanner.CATEGORIES.associateWith { category -> newIndex[category]?.size ?: 0 }
    }

    private fun EventSummary.toDto() = EventSummaryDto(
        category = category,
        folder = folder,
        timestamp = (metadata?.timestamp ?: folderTimestamp).toString(),
        timestampSource = if (metadata?.timestamp != null) "event" else "folder",
        city = metadata?.city,
        street = metadata?.street,
        reason = metadata?.reason,
        lat = metadata?.lat,
        lon = metadata?.lon,
        camera = cameraName,
        cameraIndex = metadata?.cameraIndex,
        segmentCount = segmentCount,
        playable = playable,
    )
}
