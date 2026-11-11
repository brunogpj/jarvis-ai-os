package dev.jarvis.companion

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/**
 * Widget de conversa da tela inicial (substitui o widget da macro Conversa Premium): um toque abre a tela "Ouvindo" e o resto é o fluxo de
 * sempre (reconhecimento de fala → android_conversa → resposta falada). Não tem dados nem rede: só o atalho.
 */
class WidgetConversa : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        val pi = PendingIntent.getActivity(ctx, 0, Intent(ctx, ConversaActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        for (id in ids) {
            val v = RemoteViews(ctx.packageName, R.layout.widget_conversa)
            v.setOnClickPendingIntent(R.id.widget_raiz, pi)
            mgr.updateAppWidget(id, v)
        }
    }
}
