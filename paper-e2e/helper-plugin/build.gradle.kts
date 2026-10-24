plugins {
    alias(libs.plugins.jcommon)
}

jcommon {
    javaVersion = JavaVersion.VERSION_25

    setupPaperRepository()

    commonDependencies {
        compileOnly(libs.platform.paper)
    }
}

group = "net.okocraft.e2ehelper"
version = "1.0.0"

tasks.processResources {
    filesMatching(listOf("plugin.yml")) {
        expand("projectVersion" to version)
    }
}

tasks.jar {
    manifest {
        attributes("paperweight-mappings-namespace" to "mojang")
    }
}
