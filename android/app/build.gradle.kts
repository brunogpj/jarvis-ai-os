plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "dev.jarvis.companion"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.jarvis.companion"
        minSdk = 26          // Android 8.0; o Redmi do dono roda Android 13
        targetSdk = 34
        versionCode = 50
        versionName = "0.16.1-midia"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    buildFeatures { compose = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // FCM sem o plugin google-services: a configuração do Firebase (chave, appId, projeto) vem do pareamento,
    // guardada cifrada no aparelho. Nada disso entra no repositório (ver JarvisApp.kt).
    implementation(platform("com.google.firebase:firebase-bom:35.1.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.security:security-crypto:1.1.0")
    // Jetpack Compose (0.11.0): BOM fixa em 2025.02.00 (Compose 1.7 / Material 3 1.3), a última que compila com compileSdk 35.
    implementation(platform("androidx.compose:compose-bom:2025.02.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.10.1")
    // Cerca geográfica (0.14.0): Geofencing e posição atual do Google Play Services.
    implementation("com.google.android.gms:play-services-location:21.3.0")
    testImplementation("junit:junit:4.13.2")
}
