package dev.jarvis.companion

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Conversa por toque (0.3.0): manda o que o dono disse ao Jarvis e devolve o texto que deve ser falado.
 *
 * O /exec perde respostas (302 → 404/HTML DEPOIS de executar). Por isso toda tentativa leva o MESMO `rid`: o servidor guarda a
 * resposta por rid+mensagem e devolve a mesma, sem executar de novo (e espera o original, se ainda estiver rodando).
 * Repetir sem rid re-executaria a ação (o resumo de e-mails já saiu 3x assim).
 */
object Conversa {
    private const val TENTATIVAS = 3
    private const val FALHA = "\u0000"

    /** O texto para falar. Nunca lança: falha vira uma frase honesta. */
    fun perguntar(ctx: Context, pergunta: String, rid: String): String {
        val url = Config.url(ctx)
        val token = Config.token(ctx)
        if (url == null || token == null) return "O aplicativo ainda não está pareado com o Jarvis."
        var motivo = "sem resposta do servidor"
        for (t in 1..TENTATIVAS) {
            val r = tentar(url, token, pergunta, rid)
            when {
                r.startsWith(FALHA) -> motivo = r.substring(1)
                r.isBlank() -> motivo = "resposta vazia"
                r.startsWith("Erro:") -> return "O Jarvis recusou o pedido. " + r.removePrefix("Erro:").trim()
                else -> return r.trim()
            }
            Config.evento(ctx, "conversa: tentativa $t falhou ($motivo)")
            if (t < TENTATIVAS) try { Thread.sleep(3000L * t) } catch (e: InterruptedException) { }
        }
        return "Não consegui falar com o Jarvis agora: $motivo."
    }

    /** Uma tentativa. Falha de rede ou página HTML (o 404 do segundo salto) volta com o prefixo de falha. */
    private fun tentar(url: String, token: String, pergunta: String, rid: String): String {
        return try {
            val c = URL(url).openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.doOutput = true
            c.connectTimeout = 15000
            c.readTimeout = 170000          // o modelo pode levar mais de 2 minutos; o servidor tem teto de 6
            c.instanceFollowRedirects = true
            c.setRequestProperty("Content-Type", "application/json")
            val corpo = JSONObject().put("action", "android_conversa").put("token", token)
                .put("message", pergunta).put("rid", rid).put("falar", "local")
            c.outputStream.use { it.write(corpo.toString().toByteArray(Charsets.UTF_8)) }
            val codigo = c.responseCode
            val ok = codigo in 200..299
            val texto = (if (ok) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            c.disconnect()
            when {
                !ok -> FALHA + "HTTP $codigo"
                texto.trimStart().startsWith("<") -> FALHA + "o servidor devolveu uma página em vez da resposta"
                else -> texto
            }
        } catch (e: Exception) {
            FALHA + e.javaClass.simpleName
        }
    }
}
