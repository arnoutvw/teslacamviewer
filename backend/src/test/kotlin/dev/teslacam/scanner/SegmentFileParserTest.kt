package dev.teslacam.scanner

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.io.TempDir
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
import java.time.LocalDateTime

class SegmentFileParserTest {
    private val parser = SegmentFileParser()

    @TempDir
    lateinit var tmp: Path

    private fun file(name: String, bytes: Long = 100): Path {
        val p = tmp.resolve(name)
        Files.write(p, ByteArray(bytes.toInt()))
        return p
    }

    @Test
    fun `parses real filename`() {
        val s = parser.parse(file("2026-07-10_17-19-23-back.mp4"))!!
        assertEquals(LocalDateTime.of(2026, 7, 10, 17, 19, 23), s.start)
        assertEquals("back", s.camera)
        assertEquals(100, s.bytes)
    }

    @Test
    fun `parses multiword camera name`() {
        val s = parser.parse(file("2026-05-27_21-03-22-left_repeater.mp4"))!!
        assertEquals("left_repeater", s.camera)
    }

    @Test
    fun `rejects non-segment files`() {
        assertNull(parser.parse(file("event.json")))
        assertNull(parser.parse(file("thumb.png")))
        assertNull(parser.parse(file("notasegment.mp4")))
    }

    @Test
    fun `accepts zero-byte segment`() {
        val s = parser.parse(file("2026-05-27_20-56-21-front.mp4", bytes = 0))!!
        assertEquals(0, s.bytes)
    }
}