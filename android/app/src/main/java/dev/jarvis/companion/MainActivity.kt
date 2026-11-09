package dev.jarvis.companion

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import java.net.URI

/**
 * Tela do app (0.5.0, "nova cara"): três áreas numa barra inferior — Conversa (o orbe para falar e a última troca),
 * Sistema (conexão, notificações, eventos) e Voz (tom e ritmo da voz do celular). Também é a porta do pareamento.
 *
 * Pareamento (uma vez, pelo computador, sem digitar nada no celular; o JSON NÃO fica no repositório):
 *   adb shell am start -n dev.jarvis.companion/.MainActivity --es config_b64 <JSON em base64>
 */
class MainActivity : Activity() {
    private lateinit var conteudo: FrameLayout
    private lateinit var selo: TextView
    private lateinit var subtitulo: TextView
    private val abas = ArrayList<Pair<IconeAbaView, TextView>>()
    private var aba = 0
    private var assinatura = ""
    private val relogio = Handler(Looper.getMainLooper())
    private val vigia = object : Runnable {
        override fun run() {
            // Reconstrói Conversa e Sistema quando algo mudou (resposta chegou, evento novo). Voz não: reconstruir tiraria o dedo do controle.
            if (aba != 2) {
                val ass = assinaturaAtual()
                if (ass != assinatura) { mostrar(aba) }
            }
            atualizarCabecalho()
            relogio.postDelayed(this, 2500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Cores.FUNDO
        window.navigationBarColor = Cores.BARRA
        montarTela()
        tratarPareamento(intent)
        tratarAjusteDeVoz(intent)
        pedirPermissaoDeNotificacao()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        tratarPareamento(intent)
        tratarAjusteDeVoz(intent)
    }

    override fun onResume() {
        super.onResume()
        mostrar(aba)
        AckQueue.drenarAgora(this)
        NotifFila.drenarAgora(this)
        relogio.postDelayed(vigia, 2500)
    }

    override fun onPause() {
        relogio.removeCallbacks(vigia)
        super.onPause()
    }

    // ---------------------------------------------------------------- estrutura

    private fun montarTela() {
        val raiz = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Cores.FUNDO) }

        // cabeçalho: marca + nome + aparelho/versão, e o selo de estado à direita
        val marca = MarcaView(this).apply { layoutParams = LinearLayout.LayoutParams(dp(36), dp(36)) }
        val titulo = TextView(this).apply {
            text = "Jarvis"; textSize = 24f; setTextColor(Cores.TEXTO); typeface = Tipografia.grotesk(this@MainActivity, 700)
        }
        subtitulo = TextView(this).apply { textSize = 12f; setTextColor(Cores.SECUNDARIO) }
        val nomes = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, 0, 0)
            addView(titulo); addView(subtitulo)
        }
        selo = TextView(this).apply { textSize = 12f; typeface = Tipografia.inter(this@MainActivity, 500); gravity = Gravity.CENTER }
        val cabecalho = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(8))
            addView(marca); addView(nomes, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)); addView(selo)
        }

        conteudo = FrameLayout(this)

        // barra inferior
        val barra = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; setBackgroundColor(Cores.BARRA); setPadding(dp(12), dp(6), dp(12), dp(10))
        }
        listOf("Conversa", "Sistema", "Voz").forEachIndexed { i, nome ->
            val icone = IconeAbaView(this, i)
            val t = TextView(this).apply { text = nome; textSize = 12f; gravity = Gravity.CENTER }
            val celula = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; minimumHeight = dp(56)
                isClickable = true; isFocusable = true; contentDescription = nome
                addView(icone, LinearLayout.LayoutParams(dp(22), dp(22)))
                addView(t, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(4) })
                setOnClickListener { mostrar(i) }
            }
            abas.add(Pair(icone, t))
            barra.addView(celula, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }

        raiz.addView(cabecalho)
        raiz.addView(conteudo, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        raiz.addView(View(this).apply { setBackgroundColor(Cores.DIVISOR) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1))
        raiz.addView(barra)
        setContentView(raiz)
    }

    private fun mostrar(i: Int) {
        aba = i
        assinatura = assinaturaAtual()
        abas.forEachIndexed { idx, (icone, t) ->
            val cor = if (idx == i) Cores.DESTAQUE else Cores.SECUNDARIO
            icone.cor = cor
            t.setTextColor(cor)
            t.typeface = Tipografia.inter(this, if (idx == i) 600 else 500)
        }
        conteudo.removeAllViews()
        conteudo.addView(when (i) { 0 -> telaConversa(); 1 -> telaSistema(); else -> telaVoz() })
        atualizarCabecalho()
    }

    private fun assinaturaAtual(): String {
        val e = Config.estado(this)
        return (e.getString("ultima_pergunta", "") ?: "") + "|" + (e.getString("ultima_resposta", "") ?: "") + "|" +
            Config.eventos(this) + "|" + AckQueue.pendentes(this) + "|" + NotifFila.pendentes(this)
    }

    private fun atualizarCabecalho() {
        subtitulo.text = "${Build.MODEL} · v${BuildConfigVersao.NOME.substringBefore("-")}"
        val ok = Config.pareado(this) && AckQueue.pendentes(this) == 0
        selo.text = if (ok) "Conectado" else if (!Config.pareado(this)) "Sem pareamento" else "Atenção"
        selo.setTextColor(if (ok) Color.parseColor("#bff5dc") else Color.parseColor("#ffd9a0"))
        selo.background = fundoArredondado(if (ok) Color.parseColor("#12213a") else Color.parseColor("#2a2113"), dp(16).toFloat(),
            if (ok) Color.parseColor("#1f3b52") else Color.parseColor("#4a3a1c"), 1)
        selo.setPadding(dp(14), 0, dp(14), 0)
        selo.minHeight = dp(32)
    }

    // ---------------------------------------------------------------- Conversa

    private fun telaConversa(): View {
        val e = Config.estado(this)
        val pergunta = e.getString("ultima_pergunta", null)
        val resposta = e.getString("ultima_resposta", null)

        val baloes = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.BOTTOM
            setPadding(dp(20), dp(16), dp(20), dp(8))
        }
        if (pergunta == null) {
            baloes.addView(texto("Toque no orbe e fale, ou use um atalho. Segure um atalho para trocar a frase.", 15f, Cores.SECUNDARIO).apply {
                gravity = Gravity.CENTER; setPadding(dp(16), 0, dp(16), dp(24))
            })
        } else {
            baloes.addView(texto("ÚLTIMA CONVERSA", 11f, Cores.SECUNDARIO).apply {
                gravity = Gravity.CENTER; letterSpacing = 0.08f; setPadding(0, 0, 0, dp(12))
            })
            baloes.addView(balao(pergunta, voce = true))
            baloes.addView(balao(resposta ?: "", voce = false))
        }
        val rolagem = ScrollView(this).apply {
            isFillViewport = true; overScrollMode = View.OVER_SCROLL_NEVER
            addView(baloes, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            post { fullScroll(View.FOCUS_DOWN) }
        }

        val frases = atalhos()
        val linhaChips = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(20), dp(8), dp(20), dp(4)) }
        frases.forEach { f ->
            linhaChips.addView(Button(this).apply {
                text = f; isAllCaps = false; textSize = 14f; setTextColor(Cores.TEXTO2); minHeight = dp(44); minimumHeight = dp(44)
                setPadding(dp(16), 0, dp(16), 0)
                background = fundoArredondado(Cores.CARTAO, dp(22).toFloat(), Color.parseColor("#2a335e"), 1)
                stateListAnimator = null
                typeface = Tipografia.inter(this@MainActivity, 500)
                setOnClickListener { perguntar(f) }
                setOnLongClickListener { editarAtalho(frases.indexOf(f)); true }      // segurar = trocar a frase
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(44)).apply { rightMargin = dp(8) })
        }
        val chips = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(linhaChips) }

        val orbe = OrbeView(this).apply { setOnClickListener { startActivity(Intent(this@MainActivity, ConversaActivity::class.java)) } }
        val legenda = texto("Toque para falar", 14f, Cores.TEXTO2).apply { gravity = Gravity.CENTER; typeface = Tipografia.inter(this@MainActivity, 500) }
        val rodape = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(0, dp(14), 0, dp(12))
            addView(orbe, LinearLayout.LayoutParams(dp(152), dp(152)))
            addView(legenda, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(2) })
        }

        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(rolagem, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(chips)
            addView(rodape)
        }
    }

    private val atalhosPadrao = listOf("Que horas são", "Quanto tenho livre", "O que vence hoje")

    private fun atalhos(): List<String> = try {
        val j = org.json.JSONArray(Config.estado(this).getString("atalhos", "") ?: "")
        (0 until 3).map { j.optString(it, "").ifBlank { atalhosPadrao[it] } }
    } catch (e: Exception) { atalhosPadrao }

    /** Segurar uma pílula abre uma caixa para trocar a frase (até 40 caracteres); em branco volta à frase original. */
    private fun editarAtalho(indice: Int) {
        if (indice !in 0..2) return
        val campo = android.widget.EditText(this).apply {
            setText(atalhos()[indice]); setSelection(text.length); setSingleLine(true); filters = arrayOf(android.text.InputFilter.LengthFilter(40))
            setTextColor(Cores.TEXTO); typeface = Tipografia.inter(this@MainActivity, 400)
        }
        android.app.AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Frase do atalho")
            .setView(LinearLayout(this).apply { setPadding(dp(20), dp(8), dp(20), 0); addView(campo, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)) })
            .setPositiveButton("Salvar") { _, _ ->
                val j = org.json.JSONArray(); atalhos().forEachIndexed { i, f -> j.put(if (i == indice) campo.text.toString().trim() else f) }
                Config.estado(this).edit().putString("atalhos", j.toString()).apply(); mostrar(0)
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    /** Pergunta direta (as pílulas): o mesmo caminho do botão de voz, sem a tela de reconhecimento. */
    private fun perguntar(frase: String) {
        val rid = System.currentTimeMillis().toString()
        Config.evento(this, "conversa: pedido de ${frase.length} caracteres")
        Config.estado(this).edit().putString("ultima_pergunta", frase).putString("ultima_resposta", "(aguardando…)").apply()
        ContextCompat.startForegroundService(this, Intent(this, FalaService::class.java).putExtra("id", "c$rid").putExtra("pergunta", frase).putExtra("rid", rid))
        mostrar(0)
    }

    private fun balao(t: String, voce: Boolean): View {
        val v = texto(t, 15f, if (voce) Cores.TEXTO else Color.parseColor("#dfe3f5")).apply {
            setLineSpacing(0f, 1.15f)
            setPadding(dp(16), dp(12), dp(16), dp(12))
            val r = dp(18).toFloat(); val c = dp(4).toFloat()
            background = GradientDrawableCantos(if (voce) Cores.BALAO_VOCE else Cores.CARTAO, if (voce) floatArrayOf(r, r, r, r, c, c, r, r) else floatArrayOf(r, r, r, r, r, r, c, c),
                if (voce) 0 else Cores.BORDA)
            maxWidth = (resources.displayMetrics.widthPixels * 0.82f).toInt()
        }
        return LinearLayout(this).apply {
            gravity = if (voce) Gravity.END else Gravity.START
            setPadding(0, 0, 0, dp(10))
            addView(v)
        }
    }

    // ---------------------------------------------------------------- Sistema

    private fun telaSistema(): View {
        val pareado = Config.pareado(this)
        val host = try { URI(Config.url(this) ?: "").host ?: "?" } catch (e: Exception) { "?" }
        val acesso = android.provider.Settings.Secure.getString(contentResolver, "enabled_notification_listeners")?.contains(packageName) == true
        val notifOk = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

        val lista = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(12), dp(20), dp(24)) }
        lista.addView(texto("Sistema", 28f, Cores.TEXTO).apply { typeface = Tipografia.grotesk(this@MainActivity, 700) })
        lista.addView(texto(if (pareado && AckQueue.pendentes(this) == 0) "Tudo certo." else "Há algo para olhar abaixo.", 13f, Cores.SECUNDARIO).apply { setPadding(0, dp(4), 0, dp(4)) })

        lista.addView(cartao("Conexão", if (pareado) "Pareado" else "Sem pareamento", pareado,
            listOf("Servidor" to (if (pareado) host else "—"), "Confirmações na fila" to AckQueue.pendentes(this).toString(), "Versão" to BuildConfigVersao.NOME.substringBefore("-"))))

        val canalLigado = NotificacaoService.ativo(this)
        lista.addView(cartao("Notificações", if (acesso && canalLigado) "Ativas" else if (acesso) "Canal desligado" else "Sem acesso", acesso && canalLigado,
            listOf("Acesso do Android" to (if (acesso) "Concedido" else "Não concedido"),
                "Aviso do app" to (if (notifOk) "Permitido" else "Negado"),
                "Apps vigiados" to NotificacaoService.apps(this).size.toString(),
                "Fila de envio" to NotifFila.pendentes(this).toString())))

        val eventos = Config.eventos(this).split("\n").filter { it.isNotBlank() }
        val cx = cartaoBase("Últimos eventos")
        if (eventos.isEmpty()) cx.addView(texto("Nada por enquanto.", 14f, Cores.SECUNDARIO))
        eventos.forEach { linha ->
            // "08/11 22:47:08  texto" → hora curta + texto
            val hora = linha.substringBefore("  ", "").substringAfter(" ", "").take(5)
            val msg = linha.substringAfter("  ", linha)
            cx.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(10), 0, dp(10))
                addView(texto(hora, 14f, Cores.SECUNDARIO).apply { minWidth = dp(46) })
                addView(texto(msg, 14f, Cores.TEXTO).apply { setPadding(dp(12), 0, 0, 0) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            })
            cx.addView(View(this).apply { setBackgroundColor(Cores.DIVISOR) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1))
        }
        lista.addView(cx)

        lista.addView(Button(this).apply {
            text = "Atualizar agora"; isAllCaps = false; typeface = Tipografia.inter(this@MainActivity, 600); textSize = 15f; setTextColor(Cores.TEXTO); stateListAnimator = null
            background = fundoArredondado(Cores.BALAO_VOCE, dp(14).toFloat())
            setOnClickListener { AckQueue.drenarAgora(context); NotifFila.drenarAgora(context); NotificacaoService.atualizarEmSegundoPlano(context); mostrar(1) }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(12) })

        return ScrollView(this).apply { overScrollMode = View.OVER_SCROLL_NEVER; addView(lista) }
    }

    private fun cartaoBase(titulo: String): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = fundoArredondado(Cores.CARTAO, dp(16).toFloat(), Cores.BORDA, 1)
        setPadding(dp(16), dp(16), dp(16), dp(10))
        addView(texto(titulo, 17f, Cores.TEXTO).apply { typeface = Tipografia.grotesk(this@MainActivity, 500); setPadding(0, 0, 0, dp(8)) })
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) }
    }

    private fun cartao(titulo: String, estado: String, bom: Boolean, linhas: List<Pair<String, String>>): View {
        val c = cartaoBase(titulo)
        val cab = c.getChildAt(0) as TextView
        c.removeViewAt(0)
        c.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(cab, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(texto("● $estado", 12f, if (bom) Color.parseColor("#bff5dc") else Color.parseColor("#ffd9a0")).apply { typeface = Tipografia.inter(this@MainActivity, 500) })
        }, 0)
        linhas.forEach { (k, v) ->
            c.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(5), 0, dp(7))
                addView(texto(k, 14f, Cores.SECUNDARIO), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                addView(texto(v, 14f, Cores.TEXTO))
            })
        }
        return c
    }

    // ---------------------------------------------------------------- Voz

    private fun telaVoz(): View {
        val e = Config.estado(this)
        val genero = e.getString("genero", "m") ?: "m"
        val tom = e.getFloat("pitch", FalaService.pitchPadrao(genero))
        val ritmo = e.getFloat("ritmo", FalaService.ritmoPadrao(genero))
        val voz = (e.getString("voz_usada", "") ?: "").ifBlank { "ainda não usada" }

        val lista = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(12), dp(20), dp(24)) }
        lista.addView(texto("Voz do celular", 28f, Cores.TEXTO).apply { typeface = Tipografia.grotesk(this@MainActivity, 700) })
        lista.addView(texto("Vale para respostas curtas (hora, saldo) e avisos. Respostas longas saem pela voz premium do Jarvis.", 13f, Cores.SECUNDARIO).apply { setPadding(0, dp(4), 0, dp(4)) })

        val c = cartaoBase("Ajuste")
        c.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; setPadding(0, 0, 0, dp(8))
            listOf("m" to "Masculina", "f" to "Feminina").forEach { (g, nome) ->
                val ativo = g == genero
                addView(Button(this@MainActivity).apply {
                    text = nome; isAllCaps = false; textSize = 14f; stateListAnimator = null; typeface = Tipografia.inter(this@MainActivity, 600)
                    setTextColor(if (ativo) Cores.FUNDO else Cores.TEXTO2)
                    background = fundoArredondado(if (ativo) Cores.DESTAQUE else Color.TRANSPARENT, dp(12).toFloat(), if (ativo) Cores.DESTAQUE else Cores.BORDA, dp(1))
                    setOnClickListener { trocarGenero(g) }
                }, LinearLayout.LayoutParams(0, dp(44), 1f).apply { rightMargin = if (g == "m") dp(8) else 0 })
            }
        })
        c.addView(controle("Tom", tom, "pitch"))
        c.addView(controle("Ritmo", ritmo, "ritmo"))
        c.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(6), 0, dp(10))
            addView(texto("Voz", 14f, Cores.SECUNDARIO), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(texto(voz, 14f, Cores.TEXTO))
        })
        c.addView(Button(this).apply {
            text = "Ouvir uma amostra"; isAllCaps = false; typeface = Tipografia.inter(this@MainActivity, 600); textSize = 15f; setTextColor(Cores.DESTAQUE); stateListAnimator = null
            background = fundoArredondado(Color.TRANSPARENT, dp(12).toFloat(), Cores.DESTAQUE, dp(1))
            setOnClickListener {
                ContextCompat.startForegroundService(context, Intent(context, FalaService::class.java)
                    .putExtra("id", "t" + System.currentTimeMillis().toString(36))
                    .putExtra("texto", "Boa noite. Esta é a voz do Jarvis neste celular.").putExtra("local", true))
            }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)).apply { bottomMargin = dp(6) })
        lista.addView(c)

        lista.addView(Button(this).apply {
            text = "Voltar ao padrão"; isAllCaps = false; typeface = Tipografia.inter(this@MainActivity, 600); textSize = 14f; setTextColor(Cores.TEXTO2); stateListAnimator = null
            background = fundoArredondado(Color.TRANSPARENT, 0f)
            setOnClickListener {
                Config.estado(context).edit().remove("pitch").remove("ritmo").apply()
                mostrar(2)
            }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)).apply { topMargin = dp(8) })

        return ScrollView(this).apply { overScrollMode = View.OVER_SCROLL_NEVER; addView(lista) }
    }

    /** Troca masculina/feminina: zera os ajustes de tom e ritmo (cada voz tem o seu ponto de partida) e já fala uma amostra. */
    private fun trocarGenero(g: String) {
        Config.estado(this).edit().putString("genero", g).remove("voz_preferida").remove("pitch").remove("ritmo").apply()
        Config.evento(this, "voz do celular: " + if (g == "f") "feminina" else "masculina")
        ContextCompat.startForegroundService(this, Intent(this, FalaService::class.java)
            .putExtra("id", "t" + System.currentTimeMillis().toString(36))
            .putExtra("texto", "Boa noite. Esta é a voz do Jarvis neste celular.").putExtra("local", true))
        mostrar(2)
        relogio.postDelayed({ if (aba == 2) mostrar(2) }, 3000)     // a voz escolhida aparece depois da amostra
    }

    /** Controle deslizante de 0,50 a 1,50 que grava na hora (e já vale na próxima fala). */
    private fun controle(nome: String, valor: Float, chave: String): View {
        val numero = texto(String.format(java.util.Locale("pt", "BR"), "%.2f", valor), 14f, Cores.TEXTO)
        val barra = SeekBar(this).apply {
            max = 100; progress = Math.round((valor - 0.5f) * 100f).coerceIn(0, 100)
            progressTintList = android.content.res.ColorStateList.valueOf(Cores.DESTAQUE)
            thumbTintList = android.content.res.ColorStateList.valueOf(Cores.DESTAQUE)
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(Cores.BORDA)
            minimumHeight = dp(44)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(s: SeekBar?, p: Int, deUsuario: Boolean) {
                    val v = 0.5f + p / 100f
                    numero.text = String.format(java.util.Locale("pt", "BR"), "%.2f", v)
                    if (deUsuario) Config.estado(this@MainActivity).edit().putFloat(chave, v).apply()
                }
                override fun onStartTrackingTouch(s: SeekBar?) {}
                override fun onStopTrackingTouch(s: SeekBar?) {}
            })
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(0, dp(4), 0, dp(4))
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(texto(nome, 14f, Cores.SECUNDARIO), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                addView(numero)
            })
            addView(barra, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)))
        }
    }

    private fun texto(t: String, sp: Float, cor: Int) = TextView(this).apply { text = t; textSize = sp; setTextColor(cor); typeface = Tipografia.inter(this@MainActivity, 400) }

    // ---------------------------------------------------------------- pareamento e ajuste por ADB (como antes)

    private fun tratarPareamento(i: Intent?) {
        val b64 = i?.getStringExtra("config_b64") ?: return
        i.removeExtra("config_b64")
        val json = try { String(Base64.decode(b64, Base64.DEFAULT), Charsets.UTF_8) } catch (e: Exception) { null }
        val erro = if (json == null) "base64 inválido" else Config.salvar(this, json)
        if (erro != null) { Config.evento(this, "pareamento recusado: $erro"); mostrar(aba); return }
        Config.evento(this, "pareamento aceito")
        try { Config.iniciarFirebase(this) } catch (e: Exception) { Config.evento(this, "Firebase não iniciou: ${e.message}"); mostrar(aba); return }
        FirebaseMessaging.getInstance().token.addOnCompleteListener { t ->
            if (!t.isSuccessful) { Config.evento(this, "FCM sem token: ${t.exception?.message}"); runOnUiThread { mostrar(aba) }; return@addOnCompleteListener }
            Thread {
                val ok = Api.registrar(this, t.result)
                Config.evento(this, if (ok) "aparelho registrado no Jarvis" else "NÃO consegui registrar o aparelho (sem rede ou token errado)")
                runOnUiThread { mostrar(aba) }
            }.start()
        }
        mostrar(aba)
    }

    /**
     * Ajuste fino da voz do celular por ADB (a tela Voz faz o mesmo sem computador):
     *   adb shell am start -n dev.jarvis.companion/.MainActivity --ef pitch 0.8 --ef ritmo 0.92 --es voz pt-br-x-pte-network --es testar "frase"
     * pitch/ritmo: 0.5 a 1.5; voz: nome exato de uma voz pt-BR; testar: fala a frase agora. "voz" vazia volta à escolha automática.
     */
    private fun tratarAjusteDeVoz(i: Intent?) {
        if (i == null) return
        val e = Config.estado(this).edit()
        var mudou = false
        if (i.hasExtra("pitch")) { e.putFloat("pitch", i.getFloatExtra("pitch", 0.88f).coerceIn(0.5f, 1.5f)); mudou = true }
        if (i.hasExtra("ritmo")) { e.putFloat("ritmo", i.getFloatExtra("ritmo", 0.95f).coerceIn(0.5f, 1.5f)); mudou = true }
        if (i.hasExtra("voz")) { e.putString("voz_preferida", i.getStringExtra("voz") ?: ""); mudou = true }
        if (mudou) { e.apply(); Config.evento(this, "ajuste de voz gravado") }
        val frase = i.getStringExtra("testar")
        if (frase != null) {
            val s = Intent(this, FalaService::class.java).putExtra("id", "t" + System.currentTimeMillis().toString(36)).putExtra("texto", frase).putExtra("local", true)
            ContextCompat.startForegroundService(this, s)
        }
        i.removeExtra("pitch"); i.removeExtra("ritmo"); i.removeExtra("voz"); i.removeExtra("testar")
    }

    private fun pedirPermissaoDeNotificacao() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }
}
