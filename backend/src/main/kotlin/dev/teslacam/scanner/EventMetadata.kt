package dev.teslacam.scanner

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.time.LocalDateTime
import java.time.format.DateTimeParseException

data class EventMetadata(
    val timestamp: LocalDateTime?,
    val city: String?,
    val street: String?,
    val lat: Double?,
    val lon: Double?,
    val reason: String?,
    val cameraIndex: Int?,
)

class EventMetadataParser {
    private val mapper = ObjectMapper()

    fun parse(json: String): EventMetadata {
        val n: JsonNode = try { mapper.readTree(json) } catch (_: Exception) { return allNulls() }
        return EventMetadata(
            timestamp = n.get("timestamp")?.asText()?.let { parseTime(it) },
            city = nullableText(n, "city"),
            street = nullableText(n, "street"),
            lat = doubleField(n, "est_lat"),
            lon = doubleField(n, "est_lon"),
            reason = nullableText(n, "reason"),
            cameraIndex = n.get("camera")?.asText()?.trim()?.toIntOrNull(),
        )
    }

    private fun allNulls() = EventMetadata(null, null, null, null, null, null, null)

    private fun nullableText(n: JsonNode, field: String): String? {
        val node = n.get(field) ?: return null
        if (node.isNull) return null
        val v = node.asText()?.trim()
        return v?.takeIf { it.isNotEmpty() }
    }

    private fun doubleField(n: JsonNode, field: String): Double? = nullableText(n, field)?.toDoubleOrNull()

    private fun parseTime(v: String): LocalDateTime? =
        try { LocalDateTime.parse(v) } catch (_: DateTimeParseException) { null }
}
