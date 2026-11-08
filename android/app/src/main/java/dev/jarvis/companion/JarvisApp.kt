package dev.jarvis.companion

import android.app.Application

/**
 * Roda ANTES de qualquer serviço. O FCM pode acordar o app só para entregar uma ordem, e o serviço de mensagens precisa
 * de um Firebase já iniciado: sem o plugin google-services, quem inicia é esta classe, com a configuração do pareamento.
 */
class JarvisApp : Application() {
    override fun onCreate() {
        super.onCreate()
        try { Config.iniciarFirebase(this) } catch (e: Exception) { Config.evento(this, "Firebase não iniciou: ${e.message}") }
        AckQueue.drenarAgora(this)
    }
}
