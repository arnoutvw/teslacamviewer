package dev.teslacam

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.scheduling.annotation.EnableScheduling

@SpringBootApplication
@EnableScheduling
class TeslaCamApplication

fun main(args: Array<String>) {
    runApplication<TeslaCamApplication>(*args)
}