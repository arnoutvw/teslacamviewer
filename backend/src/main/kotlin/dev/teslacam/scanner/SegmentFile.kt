package dev.teslacam.scanner

import java.nio.file.Files
import java.nio.file.Path
import java.time.LocalDateTime

data class SegmentFile(val start: LocalDateTime, val camera: String, val file: Path, val bytes: Long)

class SegmentFileParser {
    private val pattern =
        Regex("""^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-([a-z_]+)\.mp4$""")

    fun parse(file: Path): SegmentFile? {
        val m = pattern.matchEntire(file.fileName.toString()) ?: return null
        val g = m.groupValues
        val start = LocalDateTime.of(
            g[1].toInt(), g[2].toInt(), g[3].toInt(), g[4].toInt(), g[5].toInt(), g[6].toInt(),
        )
        return SegmentFile(start, g[7], file, Files.size(file))
    }
}
