package dev.teslacam.scanner

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.nio.file.Files
import java.nio.file.Path
import java.time.LocalDateTime

data class EventSummary(
    val category: String,
    val folder: String,
    val folderTimestamp: LocalDateTime,
    val metadata: EventMetadata?,
    val cameraName: String?,
    val segmentCount: Int,
    val playable: Boolean,
)

data class SegmentInfo(
    val camera: String,
    val start: LocalDateTime,
    val url: String,
    val playable: Boolean,
    val estimatedSeconds: Double,
)

data class TimelineInfo(val start: LocalDateTime, val end: LocalDateTime)

data class EventDetail(
    val summary: EventSummary,
    val segmentsByCamera: Map<String, List<SegmentInfo>>,
    val timeline: TimelineInfo,
)

@Component
class EventScanner(
    @Value("\${teslacam.root}") private val root: String,
    private val cameras: CameraConfig,
) {
    companion object {
        val CATEGORIES = listOf("RecentClips", "SavedClips", "SentryClips")
        private const val BYTES_PER_SECOND = 1_400_000.0
        private val jsonParser = EventMetadataParser()
        private val segmentParser = SegmentFileParser()
    }

    fun scan(): Map<String, List<EventSummary>> {
        val rootDir = Path.of(root)
        if (!Files.isDirectory(rootDir)) return emptyMap()
        return CATEGORIES.associateWith { category -> scanCategory(rootDir, category) }
    }

    private fun scanCategory(rootDir: Path, category: String): List<EventSummary> {
        val dir = rootDir.resolve(category)
        if (!Files.isDirectory(dir)) return emptyList()
        return Files.list(dir).use { stream ->
            stream.filter { Files.isDirectory(it) }
                .map { folder -> summarize(category, folder) }
                // Spec: "Event = folder containing at least one .mp4" — drop empty/thumbnail-only folders.
                .filter { it.segmentCount > 0 }
                .toList()
                .sortedBy { it.folderTimestamp }
        }
    }

    private fun summarize(category: String, folder: Path): EventSummary {
        val segments = segmentsOf(folder)
        val metadata = folder.resolve("event.json").takeIf { Files.isRegularFile(it) }
            ?.let { runCatching { Files.readString(it) }.getOrNull() }
            ?.takeUnless { it.isBlank() }
            ?.let { jsonParser.parse(it) }
        // parse() never throws on corrupt json; an EventMetadata with every field
        // null means unusable/absent json => store null. Partial metadata (e.g. only
        // reason/camera) is kept so those fields reach the API DTO.
        val effective = metadata?.takeUnless { it.allFieldsNull() }
        return EventSummary(
            category = category,
            folder = folder.fileName.toString(),
            folderTimestamp = parseFolderTimestamp(folder.fileName.toString()),
            metadata = effective,
            cameraName = effective?.cameraIndex?.let { cameras.cameraName(it) },
            segmentCount = segments.size,
            playable = segments.any { it.bytes > 0 },
        )
    }

    private fun segmentsOf(folder: Path): List<SegmentFile> =
        runCatching {
            Files.list(folder).use { s ->
                s.toList()
                    .filter { Files.isRegularFile(it) }
                    // A file that matches the regex but has an invalid timestamp (DateTimeException)
                    // or vanishes before Files.size (IOException) is treated as absent.
                    .mapNotNull { runCatching { segmentParser.parse(it) }.getOrNull() }
            }
        }.getOrDefault(emptyList())

    fun detail(category: String, folder: String): EventDetail? {
        val summaries = scan().getOrElse(category) { return null }
        val summary = summaries.find { it.folder == folder } ?: return null
        val segments = segmentsOf(Path.of(root).resolve(category).resolve(folder))
        val byCamera = segments
            .groupBy { it.camera }
            .mapValues { (_, list) ->
                list.sortedBy { it.start }.map { seg ->
                    SegmentInfo(
                        camera = seg.camera,
                        start = seg.start,
                        url = "/media/$category/$folder/${seg.file.fileName}",
                        playable = seg.bytes > 0,
                        // Prefer the real mp4 duration; the size-based estimate has
                        // proven ~2x off for Tesla's smaller-camera bitrates.
                        estimatedSeconds = maxOf(1.0, seg.durationSeconds ?: seg.bytes / BYTES_PER_SECOND),
                    )
                }
            }
        val first = byCamera.values.minOfOrNull { it.first().start }
        val lastEnd = byCamera.values.maxOfOrNull { list ->
            val last = list.last()
            last.start.plusSeconds(last.estimatedSeconds.toLong())
        }
        val timeline = TimelineInfo(
            start = first ?: summary.folderTimestamp,
            end = lastEnd ?: summary.folderTimestamp,
        )
        return EventDetail(summary, byCamera, timeline)
    }

    private fun EventMetadata.allFieldsNull(): Boolean =
        timestamp == null && city == null && street == null && lat == null &&
            lon == null && reason == null && cameraIndex == null

    private fun parseFolderTimestamp(folder: String): LocalDateTime =
        try {
            val m = Regex("""^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$""").matchEntire(folder)
            if (m == null) LocalDateTime.MIN else LocalDateTime.of(
                m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt(),
                m.groupValues[4].toInt(), m.groupValues[5].toInt(), m.groupValues[6].toInt(),
            )
        } catch (_: Exception) {
            LocalDateTime.MIN
        }
}
