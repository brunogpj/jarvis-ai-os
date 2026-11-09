plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.jarvis.companion"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.jarvis.companion"
        minSdk = 26          // Android 8.0; o Redmi do dono roda Android 13
        targetSdk = 34
        versionCode = 25
        versionName = "0.6.5-rolar"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

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
    testImplementation("junit:junit:4.13.2")
}
