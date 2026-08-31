package dev.teslacam.scanner

import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.time.LocalDateTime

@Component
class CameraConfig @Autowired constructor(
    @Value("\${teslacam.camera-order:front,back,left_repeater,right_repeater,left_pillar,right_pillar}") raw: String,
) {
    val order: List<String> = raw.split(",").map { it.trim() }.filter { it.isNotEmpty() }

    // Convenience constructor, e.g. for unit tests: CameraConfig(listOf("front", "back")).
    constructor(order: List<String>) : this(order.joinToString(","))

    fun cameraName(index: Int): String? = order.getOrNull(index)
}
