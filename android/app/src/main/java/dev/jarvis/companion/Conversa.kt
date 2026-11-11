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
    /**
     * Frase com VÁRIAS perguntas ("que horas são, que dia é hoje, quanto eu tenho livre e o que vence hoje"): o servidor atende um pedido
     * por mensagem e respondia só a última (08/11/2026). Divide nos começos de pergunta conhecidos; com menos de duas, devolve a frase inteira.
     * "me diga" / "e" / "ou" de ligação ficam de fora de cada parte.
     */
    // Sem regex de propósito: o Android usa o motor ICU, que recusa flags como (?U) (o app travou com isso em 08/11) e trata o  de
    // forma diferente do Java do computador. A varredura abaixo confere letra por letra e dá o mesmo resultado nos dois.
    private val COMECOS = listOf("que horas", "que dia", "quantos", "quantas", "quanto", "quais", "qual", "o que", "quando")
    private val LIGACOES = listOf(" e", " ou", " também")

    private fun inicios(s: String): List<Int> {
        val m = s.lowercase()
        val achados = ArrayList<Int>()
        var i = 0
        while (i < m.length) {
            val c = COMECOS.firstOrNull { st ->
                m.startsWith(st, i) &&
                    (i == 0 || !m[i - 1].isLetterOrDigit()) &&
                    (i + st.length == m.length || !m[i + st.length].isLetterOrDigit())
            }
            if (c != null) { achados.add(i); i += c.length } else i++
        }
        return achados
    }

    private fun semLigacaoNoFim(p: String): String {
        var t = p.trim(' ', ',', '.')
        while (true) {
            val m = t.lowercase()
            val l = LIGACOES.firstOrNull { m.endsWith(it) } ?: return t
            t = t.substring(0, t.length - l.length).trim(' ', ',', '.')
        }
    }

    fun dividir(frase: String): List<String> {
        val s = frase.trim()
        val pos = inicios(s)
        if (pos.size < 2) return listOf(s)
        val partes = pos.mapIndexed { k, ini -> semLigacaoNoFim(s.substring(ini, if (k + 1 < pos.size) pos[k + 1] else s.length)) }
            .filter { it.length >= 4 }
        return if (partes.size >= 2) partes.take(5) else listOf(s)
    }

    /** Verdadeiro quando o último texto devolvido é uma resposta do Jarvis (e não um aviso de falha do próprio app). */
    @Volatile var respostaReal = false

    /** Resposta + se veio de verdade do Jarvis (e não é um aviso de falha do próprio app). Sem estado compartilhado: serve para chamadas em paralelo. */
    data class Resposta(val texto: String, val real: Boolean)

    fun perguntar(ctx: Context, pergunta: String, rid: String): String {
        val r = perguntarR(ctx, pergunta, rid)
        respostaReal = r.real
        return r.texto
    }

    fun perguntarR(ctx: Context, pergunta: String, rid: String, botao: Boolean = false): Resposta {
        val url = Config.url(ctx)
        val token = Config.token(ctx)
        if (url == null || token == null) return Resposta("O aplicativo ainda não está pareado com o Jarvis.", false)
        var motivo = "sem resposta do servidor"
        for (t in 1..TENTATIVAS) {
            val r = tentar(url, token, pergunta, rid, botao)
            when {
                r.startsWith(FALHA) -> motivo = r.substring(1)
                r.isBlank() -> motivo = "resposta vazia"
                r.startsWith("Erro:") -> return Resposta("O Jarvis recusou o pedido. " + r.removePrefix("Erro:").trim(), false)
                else -> return Resposta(r.trim(), true)
            }
            Config.evento(ctx, "conversa: tentativa $t falhou ($motivo)")
            if (t < TENTATIVAS) try { Thread.sleep(3000L * t) } catch (e: InterruptedException) { }
        }
        return Resposta("Não consegui falar com o Jarvis agora: $motivo.", false)
    }

    /**
     * Pede ao servidor a fala na voz premium do Jarvis. O áudio chega depois como uma ordem comum de fala (push) e toca quando a
     * fila liberar. Uma tentativa só: repetir falaria duas vezes. true = o servidor aceitou; false = fale pela voz do celular.
     */
    fun vozPremium(ctx: Context, texto: String): Boolean {
        val url = Config.url(ctx) ?: return false
        val token = Config.token(ctx) ?: return false
        return try {
            val c = URL(url).openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.doOutput = true
            c.connectTimeout = 15000
            c.readTimeout = 60000
            c.instanceFollowRedirects = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(JSONObject().put("action", "android_voz").put("token", token).put("texto", texto).toString().toByteArray(Charsets.UTF_8)) }
            val ok = c.responseCode in 200..299
            val r = (if (ok) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            c.disconnect()
            ok && JSONObject(r).optBoolean("ok")
        } catch (e: Exception) {
            false
        }
    }

    /** Uma tentativa. Falha de rede ou página HTML (o 404 do segundo salto) volta com o prefixo de falha. */
    private fun tentar(url: String, token: String, pergunta: String, rid: String, botao: Boolean = false): String {
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
            if (botao) corpo.put("botao", true)   // toque num botão Sim/Não/Desfaz: o servidor só consulta a confirmação pendente, nunca cai no modelo
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
