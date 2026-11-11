// Versões fixadas de propósito: AGP 8.13.2 pede Gradle 8.13 ou mais novo (o wrapper usa 8.14.6).
plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.20" apply false   // compilador do Compose, na mesma versão do Kotlin
}
