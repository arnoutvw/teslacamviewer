package dev.teslacam.scanner

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.time.LocalDateTime

class EventMetadataParserTest {
    private val parser = EventMetadataParser()

    @Test
    fun `parses full real-world event json`() {
        val json = """
            {"timestamp":"2026-07-10T17:20:19","city":"Grefrath","street":"Flugplatz",
             "est_lat":"51.3352","est_lon":"6.35791",
             "reason":"sentry_aware_object_detection","camera":"5"}
        """.trimIndent()
        val m = parser.parse(json)
        assertEquals(LocalDateTime.of(2026, 7, 10, 17, 20, 19), m.timestamp)
        assertEquals("Grefrath", m.city)
        assertEquals("Flugplatz", m.street)
        assertEquals(51.3352, m.lat!!, 1e-9)
        assertEquals(6.35791, m.lon!!, 1e-9)
        assertEquals("sentry_aware_object_detection", m.reason)
        assertEquals(5, m.cameraIndex)
    }

    @Test
    fun `nulls for missing fields`() {
        val m = parser.parse(""" {"timestamp":"2026-05-27T21:07:08"} """)
        assertEquals(LocalDateTime.of(2026, 5, 27, 21, 7, 8), m.timestamp)
        assertNull(m.city); assertNull(m.lat); assertNull(m.cameraIndex)
    }

    @Test
    fun `returns all nulls for corrupt json`() {
        val m = parser.parse(""" {"broken """)
        assertNull(m.timestamp); assertNull(m.city); assertNull(m.cameraIndex)
    }

    @Test
    fun `explicit json nulls parse to kotlin nulls`() {
        val m = parser.parse(
            """ {"timestamp":null,"city":null,"street":null,"est_lat":null,"est_lon":null,"reason":null,"camera":null} """,
        )
        assertNull(m.timestamp); assertNull(m.city); assertNull(m.street)
        assertNull(m.lat); assertNull(m.lon); assertNull(m.reason); assertNull(m.cameraIndex)
    }

    @Test
    fun `returns all nulls for empty object`() {
        val m = parser.parse("{ }")
        assertNull(m.timestamp)
    }
}