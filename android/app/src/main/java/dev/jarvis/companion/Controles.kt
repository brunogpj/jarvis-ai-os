package dev.jarvis.companion

import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.media.session.MediaSessionManager
import android.net.Uri
import android.view.KeyEvent

/**
 * Controles do celular que o MacroDroid fazia (fase 4): volume, mídia, lanterna, não perturbar, abrir app, abrir link, navegar e notificar.
 * LISTA FECHADA: a ordem `controle` traz `acao` e só estas ações são executadas; qualquer outra volta como erro.
 * Cada uma devolve (ok, detalhe) e o chamador confirma ao Jarvis (`concluido` ou `erro`), nunca em silêncio.
 */
object Controles {

    class Resultado(val ok: Boolean, val detalhe: String)

    fun executar(ctx: Context, d: Map<String, String>): Resultado = try {
        when (d["acao"]) {
            "volume" -> volume(ctx, d["nivel"] ?: "medio")
            "midia" -> midia(ctx, d["comando"] ?: "pausar")
            "lanterna" -> lanterna(ctx, d["estado"])
            "naoperturbe" -> naoPerturbe(ctx, d["estado"] ?: "on")
            "abrirapp" -> abrirApp(ctx, d["pacote"] ?: "", d["classe"] ?: "")
            "abrirurl" -> abrirUrl(ctx, d["url"] ?: "")
            "navegar" -> navegar(ctx, d["destino"] ?: "")
            "notificar" -> notificar(ctx, d["titulo"] ?: "Jarvis", d["texto"] ?: "")
            else -> Resultado(false, "ação não permitida: ${d["acao"]}")
        }
    } catch (e: SecurityException) {
        Resultado(false, "sem permissão: " + (e.message ?: "").take(80))
    } catch (e: Exception) {
        Resultado(false, (e.javaClass.simpleName + ": " + (e.message ?: "")).take(120))
    }

    // ---- volume (música/vídeo). Presets iguais aos da macro Jarvis Volume: mudo 0 · baixo 20% · médio 50% · alto 100%.
    private fun volume(ctx: Context, nivel: String): Resultado {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val pct = when (nivel) { "mudo" -> 0; "baixo" -> 20; "medio" -> 50; "alto" -> 100; else -> return Resultado(false, "nível desconhecido: $nivel") }
        val v = Math.round(max * pct / 100f)
        am.setStreamVolume(AudioManager.STREAM_MUSIC, v, 0)
        return Resultado(true, "volume $nivel ($v/$max)")
    }

    // ---- mídia: pausar e tocar são comandos distintos (alternar fazia "pausa" tocar, 25/09).
    private fun midia(ctx: Context, comando: String): Resultado {
        val tecla = when (comando) {
            "pausar" -> KeyEvent.KEYCODE_MEDIA_PAUSE; "tocar" -> KeyEvent.KEYCODE_MEDIA_PLAY
            "proxima" -> KeyEvent.KEYCODE_MEDIA_NEXT; "anterior" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            else -> return Resultado(false, "comando de mídia desconhecido: $comando")
        }
        // 1) sessão de mídia ativa (precisa do acesso a notificações, que o app já tem); 2) tecla de mídia pelo sistema.
        try {
            val msm = ctx.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
            val sessoes = msm.getActiveSessions(ComponentName(ctx, NotificacaoService::class.java))
            val s = sessoes.firstOrNull()
            if (s != null) {
                val t = s.transportControls
                when (tecla) {
                    KeyEvent.KEYCODE_MEDIA_PAUSE -> t.pause(); KeyEvent.KEYCODE_MEDIA_PLAY -> t.play()
                    KeyEvent.KEYCODE_MEDIA_NEXT -> t.skipToNext(); else -> t.skipToPrevious()
                }
                return Resultado(true, "$comando em ${s.packageName}")
            }
        } catch (_: SecurityException) { /* sem acesso à sessão: tenta pela tecla */ }
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, tecla))
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, tecla))
        return Resultado(true, "$comando (tecla de mídia; nenhuma sessão ativa)")
    }

    // ---- lanterna: estado on/off; sem estado alterna. O app lembra o último estado que ele mesmo pôs.
    private var lanternaLigada = false
    private fun lanterna(ctx: Context, estado: String?): Resultado {
        val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val id = cm.cameraIdList.firstOrNull { cm.getCameraCharacteristics(it).get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
            ?: return Resultado(false, "este aparelho não tem lanterna")
        val ligar = when (estado) { "on" -> true; "off" -> false; else -> !lanternaLigada }
        cm.setTorchMode(id, ligar)
        lanternaLigada = ligar
        return Resultado(true, if (ligar) "lanterna ligada" else "lanterna apagada")
    }

    // ---- não perturbe: exige "acesso ao Não Perturbe" (adb: cmd notification allow_dnd dev.jarvis.companion).
    private fun naoPerturbe(ctx: Context, estado: String): Resultado {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (!nm.isNotificationPolicyAccessGranted) return Resultado(false, "falta conceder o acesso ao Não Perturbe ao app")
        val ligar = estado == "on"
        nm.setInterruptionFilter(if (ligar) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL)
        return Resultado(true, if (ligar) "não perturbe ligado" else "não perturbe desligado")
    }

    // ---- abrir app / link / navegar: iniciam uma tela a partir do fundo (precisa de "exibir sobre outros apps").
    private fun iniciar(ctx: Context, i: Intent): Resultado {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
        return Resultado(true, "aberto")
    }

    private fun abrirApp(ctx: Context, pacote: String, classe: String): Resultado {
        if (pacote.isBlank()) return Resultado(false, "pacote vazio")
        val i = if (classe.isNotBlank()) Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setComponent(ComponentName(pacote, classe))
        else ctx.packageManager.getLaunchIntentForPackage(pacote) ?: return Resultado(false, "app não instalado: $pacote")
        return iniciar(ctx, i).let { Resultado(it.ok, "app $pacote aberto") }
    }

    // Só esquemas conhecidos: o servidor monta a URL, mas o app não abre qualquer coisa que chegue.
    private val esquemas = setOf("http", "https", "tel", "geo", "spotify", "youversion", "tg", "google.navigation", "mailto", "sms")

    private fun abrirUrl(ctx: Context, url: String): Resultado {
        val u = Uri.parse(url)
        if (url.isBlank() || (u.scheme ?: "").lowercase() !in esquemas) return Resultado(false, "link não permitido: ${(u.scheme ?: "sem esquema")}")
        return iniciar(ctx, Intent(Intent.ACTION_VIEW, u)).let { Resultado(it.ok, "link aberto") }
    }

    // ---- notificar: aviso proativo do Jarvis (substitui a macro Jarvis Notificar). Canal próprio, importância alta (aparece e toca como aviso).
    private var proximoIdAviso = 5000
    private fun notificar(ctx: Context, titulo: String, texto: String): Resultado {
        if (texto.isBlank() && titulo.isBlank()) return Resultado(false, "aviso vazio")
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(android.app.NotificationChannel("avisos", "Avisos do Jarvis", NotificationManager.IMPORTANCE_HIGH))
        val abrir = android.app.PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT)
        val n = android.app.Notification.Builder(ctx, "avisos")
            .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(titulo.take(120)).setContentText(texto.take(300))
            .setStyle(android.app.Notification.BigTextStyle().bigText(texto.take(1000)))
            .setContentIntent(abrir).setAutoCancel(true).build()
        nm.notify(proximoIdAviso++, n)
        if (proximoIdAviso > 5999) proximoIdAviso = 5000
        return Resultado(true, "aviso mostrado")
    }

    private fun navegar(ctx: Context, destino: String): Resultado {
        if (destino.isBlank()) return Resultado(false, "destino vazio")
        val i = Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + Uri.encode(destino))).setPackage("com.google.android.apps.maps")
        return iniciar(ctx, i).let { Resultado(it.ok, "navegação iniciada") }
    }
}
