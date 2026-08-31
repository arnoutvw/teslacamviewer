plugins {
    kotlin("jvm") version "2.3.0"
    kotlin("plugin.spring") version "2.4.10"
    id("org.springframework.boot") version "4.0.0"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "dev.teslacam"
version = "0.1.0"

java { toolchain { languageVersion = JavaLanguageVersion.of(25) } }

repositories { mavenCentral() }

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test") // @WebMvcTest moved here in Boot 4
    testImplementation("io.mockk:mockk:1.14.6")
}

tasks.withType<Test> { useJUnitPlatform() }
