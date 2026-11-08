package dev.jarvis.companion

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import java.io.File

/**
 * Atualização do próprio app, sem o dono tocar em Arquivos.
 *
 * Fluxo (feito por quem desenvolve, pelo computador, ver android/atualizar.mjs):
 *   1. o APK novo é copiado para filesDir/update/app.apk (só este caminho é aceito);
 *   2. o app é aberto com o extra `atualizar=true`;
 *   3. este objeto instala o arquivo por uma sessão do PackageInstaller.
 *
 * SEGURANÇA: quem decide se um APK pode substituir o app é o Android: só instala se for assinado com a MESMA chave. Um
 * arquivo estranho, ou de outra chave, é recusado pelo sistema. Por isso o caminho do arquivo é fixo e dentro da pasta
 * privada do app: nenhum outro aplicativo escolhe o que será instalado.
 *
 * SILENCIOSO só quando o Android permite (12+, app instalado por ESTE app e "instalar apps desconhecidos" liberado).
 * A primeira atualização, feita sobre um app instalado pelo Arquivos, pede UMA confirmação na tela; as seguintes não.
 */
object Atualizador {
    const val ACAO = "dev.jarvis.companion.INSTALACAO"

    fun arquivo(ctx: Context): File = File(File(ctx.filesDir, "update"), "app.apk")

    fun podeInstalar(ctx: Context): Boolean = ctx.packageManager.canRequestPackageInstalls()

    /** Instala o APK de filesDir/update. Devolve o motivo se não deu para começar, ou null se a sessão foi entregue ao sistema. */
    fun instalar(ctx: Context): String? {
        val apk = arquivo(ctx)
        if (!apk.exists() || apk.length() < 100_000) return "não há APK em ${apk.name} (ou está truncado)"
        if (!podeInstalar(ctx)) return "falta liberar 'Instalar apps desconhecidos' para o Jarvis (Configurações do app)"
        return try {
            val pi = ctx.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            params.setAppPackageName(ctx.packageName)
            if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            val id = pi.createSession(params)
            pi.openSession(id).use { s ->
                s.openWrite("app", 0, apk.length()).use { out -> apk.inputStream().use { it.copyTo(out) }; s.fsync(out) }
                val i = Intent(ctx, InstalacaoReceiver::class.java).setAction(ACAO)
                val pend = PendingIntent.getBroadcast(ctx, id, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
                s.commit(pend.intentSender)
            }
            Config.evento(ctx, "atualização entregue ao instalador (${apk.length() / 1024} KB)")
            null
        } catch (e: Exception) {
            "instalador recusou: ${e.message}"
        }
    }
}

/** Recebe o andamento da instalação. Pede a confirmação na tela quando o Android exige; registra o resultado. */
class InstalacaoReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        val status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val msg = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                Config.evento(ctx, "atualização aguarda UMA confirmação na tela do celular")
                @Suppress("DEPRECATION")
                val confirmar = i.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                confirmar?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (confirmar != null) ctx.startActivity(confirmar)
            }
            PackageInstaller.STATUS_SUCCESS -> Config.evento(ctx, "atualização instalada")
            else -> Config.evento(ctx, "atualização falhou ($status): $msg")
        }
    }
}
