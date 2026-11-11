package dev.jarvis.companion

import android.app.Application
import android.content.ComponentName
import android.service.notification.NotificationListenerService

/**
 * Roda ANTES de qualquer serviço. O FCM pode acordar o app só para entregar uma ordem, e o serviço de mensagens precisa
 * de um Firebase já iniciado: sem o plugin google-services, quem inicia é esta classe, com a configuração do pareamento.
 */
class JarvisApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Saude.processoIniciado(this)
        Geocerca.registrar(this); Geocerca.reenviarPendente(this); NotificacaoInterativa.drenar(this)
        try { Config.iniciarFirebase(this) } catch (e: Exception) { Config.evento(this, "Firebase não iniciou: ${e.message}") }
        AckQueue.drenarAgora(this)
        // O MIUI mata o processo (SmartPower / lowmemorykiller) e NÃO religa o ouvinte de notificações sozinho: em 09/11 a escuta estava
        // ativada nos ajustes, mas fora da lista de ouvintes vivos, e o modo sombra ficou 13 h sem receber nada. Todo início de processo
        // (o FCM acorda o app várias vezes por dia) pede ao sistema para ligar o ouvinte de novo.
        try {
            NotificationListenerService.requestRebind(ComponentName(this, NotificacaoService::class.java))
        } catch (e: Exception) { }
    }
}
