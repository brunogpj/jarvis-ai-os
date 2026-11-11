package dev.jarvis.companion

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.speech.RecognitionService

/**
 * O Jarvis como ASSISTENTE DIGITAL do Android (Configurações → Apps padrão → App assistente digital). O seletor só lista apps com um
 * VoiceInteractionService; ter a tela de ASSIST não bastava (medido em 11/11: só o Google e o Claude apareciam). Escolhido, o botão de
 * energia / gesto do assistente / "segurar o início" abrem a sessão, e a sessão abre a tela "Ouvindo" (ConversaActivity), que é o fluxo
 * de conversa de sempre. O serviço em si não escuta nada: quem usa o microfone é a ConversaActivity, depois de aparecer na tela.
 */
class JarvisVoiceInteractionService : VoiceInteractionService()

class JarvisSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession = JarvisSession(this)
}

class JarvisSession(ctx: Context) : VoiceInteractionSession(ctx) {
    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        Config.evento(context, "assistente: chamado pelo sistema")
        startAssistantActivity(Intent(context, ConversaActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        hide()
    }
}

/** Exigido pelo cadastro do assistente (VoiceInteractionServiceInfo pede um reconhecedor); não reconhece nada: o reconhecimento é o do Google, dentro da ConversaActivity. */
class JarvisReconhecedorVazio : RecognitionService() {
    override fun onStartListening(intent: Intent?, listener: Callback?) { try { listener?.error(android.speech.SpeechRecognizer.ERROR_CLIENT) } catch (_: Exception) {} }
    override fun onCancel(listener: Callback?) {}
    override fun onStopListening(listener: Callback?) {}
}
