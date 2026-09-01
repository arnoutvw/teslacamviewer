package dev.teslacam.encrypt

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import jakarta.annotation.PostConstruct
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.concurrent.ConcurrentHashMap

/**
 * FEK cache persisted as JSON at `<teslacam.root>/.teslacam_keys.json`,
 * mapping "<vin>:<key_id>:<timestamp>" -> base64 16-byte FEK.
 * Never logs FEK values.
 */
@Component
class TeslaKeyStore(@Value("\${teslacam.root}") root: String) {
    private val file = Path.of(root).resolve(".teslacam_keys.json")
    private val keys = ConcurrentHashMap<String, String>()
    private val mapper = ObjectMapper().registerKotlinModule()
    private val lock = Any()

    init {
        // @PostConstruct only fires in a Spring context; load eagerly so plain
        // instantiation (tests, manual construction) also sees persisted keys.
        load()
    }

    @PostConstruct
    fun load(): Unit = runCatching {
        if (Files.isRegularFile(file)) {
            val map: Map<String, String> =
                mapper.readValue(file.toFile(), mapper.typeFactory.constructMapType(Map::class.java, String::class.java, String::class.java))
            keys.putAll(map)
        }
    }.getOrDefault(Unit)

    fun get(storeKey: String): String? = keys[storeKey]

    fun size(): Int = keys.size

    fun putAll(newKeys: Map<String, String>): Int = synchronized(lock) {
        var added = 0
        for ((k, v) in newKeys) if (keys.putIfAbsent(k, v) == null) added++
        if (added > 0) save()
        added
    }

    private fun save(): Unit = runCatching<Unit> {
        val tmp = file.resolveSibling(".teslacam_keys.json.tmp")
        Files.write(tmp, mapper.writeValueAsBytes(keys))
        Files.move(tmp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }.onFailure { it.printStackTrace() }.getOrDefault(Unit)
}