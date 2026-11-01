plugins {
    java
    application
    alias(libs.plugins.paperweight.userdev)
}

group = "net.okocraft.spawnseedfinder"
version = "1.0.0"

java {
    toolchain.languageVersion = JavaLanguageVersion.of(25)
}

repositories {
    maven("https://repo.papermc.io/repository/maven-public/")
    mavenCentral()
}

dependencies {
    paperweight.paperDevBundle(libs.versions.paper.get())

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

// The tool runs the Minecraft server code itself (world generation, and a child Paper server for verification).
configurations.runtimeClasspath { extendsFrom(configurations.mojangMappedServerRuntime.get()) }
configurations.testRuntimeClasspath { extendsFrom(configurations.mojangMappedServerRuntime.get()) }

application {
    mainClass = "net.okocraft.spawnseedfinder.SpawnSeedFinder"
    applicationDefaultJvmArgs = listOf("-Xmx4G")
}

tasks.named<JavaExec>("run") {
    workingDir = layout.projectDirectory.dir("run").asFile
    doFirst { workingDir.mkdirs() }
}

tasks.test {
    useJUnitPlatform()
    maxHeapSize = "2G"
    workingDir = layout.buildDirectory.dir("test-run").get().asFile
    doFirst { workingDir.mkdirs() }
}
