// ==UserScript==
// @name         Inyector Maestro V36 (Respuestas directas)
// @namespace    http://tampermonkey.net/
// @version      36.0
// @description  Rellena directo desde el objeto capitulo (sin comparar ni iterar). GitHub/Local solo para calculadoras y diagramas.
// @author       mercz d
// @match        https://cursosabiertos.usfx.bo/materias/*/capitulos/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    if (!document.querySelector('.ejercicio')) return;

    // =========================================================================
    // 0. CONFIGURACIÓN Y ESTADO
    // =========================================================================
    const CONFIG = {
        GITHUB_USER: 'mael-sysm',
        GITHUB_REPO: 'cap',
        GITHUB_BRANCH: 'main',
        MAX_INTENTOS: 15,
        VERIFICAR_DIAGRAMA: true,
        ESPERA_HABILITAR_MS: 300,
        PAUSA_TRAS_CORREGIR_MS: 700
    };

    const SEL = {
        CAMPOS: '.campo_literal, .campo_arrastrar, .campo_dato',
        TODO: '.campo_literal, .campo_arrastrar, .campo_dato, p.opcionMultiple',
        SELECTORES: '.campo_arrastrar, .campo_dato',
        CORREGIR: '#btCorregir, .btCorregir',
        INPUTS_TEXTO: 'input[type="text"]:not(.notas):not(.ittiempo)'
    };

    const estado = {
        cancelado: false,
        cacheHTMLGitHub: null,
        escudoActivo: false,
        menuAbierto: false
    };

    const timersHabilitar = new Map();

    // =========================================================================
    // 1. UTILIDADES GENERALES
    // =========================================================================
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const norm = t => (t || '').replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();
    const esVisible = el => !!(el && (el.offsetParent || el.getClientRects().length));
    const sinTildes = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    async function esperarHasta(cond, max = 2000, paso = 40) {
        const fin = Date.now() + max;
        while (Date.now() < fin) {
            if (estado.cancelado) return false;
            try { if (cond()) return true; } catch (e) {}
            await sleep(paso);
        }
        return false;
    }

    function dispararEventos(el, tipos) {
        tipos.forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
    }

    function dispararShiftEnter(el, tipos = ['keydown', 'keyup']) {
        if (!el) return;
        tipos.forEach(tipo => el.dispatchEvent(new KeyboardEvent(tipo, {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            shiftKey: true, bubbles: true, cancelable: true
        })));
    }

    function showToast(message, type = 'info') {
        if (estado.cancelado) return;
        const colors = { info: '#3b82f6', success: '#16a34a', error: '#ef4444', warning: '#f59e0b' };
        const toast = document.createElement('div');
        toast.className = 'tm-inyectado';
        toast.textContent = message;
        Object.assign(toast.style, {
            position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%) translateY(100px)',
            background: colors[type] || colors.info, color: 'white', padding: '12px 24px', borderRadius: '0px',
            fontFamily: 'system-ui, sans-serif', fontSize: '14px', fontWeight: '500',
            boxShadow: '0 4px 15px rgba(0,0,0,0.2)', zIndex: '10000', opacity: '0',
            transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        });
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.transform = 'translateX(-50%) translateY(0)';
            toast.style.opacity = '1';
        });
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // =========================================================================
    // 2. ESCUDO ANTI-ROBO DE FOCO Y SCROLL
    // =========================================================================
    const originales = {
        focus: HTMLElement.prototype.focus,
        scrollIntoView: Element.prototype.scrollIntoView,
        scrollTo: window.scrollTo
    };

    function activarEscudoFoco() {
        if (estado.escudoActivo) return;
        estado.escudoActivo = true;
        const posX = window.scrollX;
        const posY = window.scrollY;
        HTMLElement.prototype.focus = function () {};
        Element.prototype.scrollIntoView = function () {};
        window.scrollTo = function () { return originales.scrollTo.call(window, posX, posY); };
    }

    function desactivarEscudoFoco() {
        if (!estado.escudoActivo) return;
        estado.escudoActivo = false;
        HTMLElement.prototype.focus = originales.focus;
        Element.prototype.scrollIntoView = originales.scrollIntoView;
        window.scrollTo = originales.scrollTo;
    }

    // =========================================================================
    // 4. LIMPIEZA AL GUARDAR / CERRAR
    // =========================================================================
    function limpiarRastro() {
        estado.cancelado = true;
        desactivarEscudoFoco();
        document.removeEventListener('click', alHacerClic, true);
        document.removeEventListener('click', interceptarGuardar, true);
        timersHabilitar.forEach(id => clearTimeout(id));
        timersHabilitar.clear();
        document.querySelectorAll('.tm-inyectado').forEach(el => el.remove());
    }

    function interceptarGuardar(evento) {
        const btn = evento.target.closest && evento.target.closest('#btGuardar, button[onclick*="savePage"]');
        if (btn) limpiarRastro();
    }

    function envolverSavePage() {
        if (typeof window.savePage !== 'function' || window.savePage._envuelto) return;
        const original = window.savePage;
        const reemplazo = function () {
            limpiarRastro();
            return original.apply(this, arguments);
        };
        reemplazo._envuelto = true;
        window.savePage = reemplazo;
    }

    // =========================================================================
    // 5. AUTO-DESBLOQUEO DEL BOTÓN CORREGIR
    // =========================================================================
    function habilitarCorregir(ej) {
        const corregir = ej.querySelector(SEL.CORREGIR);
        if (!corregir) return null;
        corregir.removeAttribute('disabled');
        corregir.disabled = false;
        return corregir;
    }

    function esBotonGenerarORepetir(boton) {
        const onclick = boton.getAttribute('onclick') || '';
        return boton.classList.contains('btGenerar') || onclick.includes('generar') ||
               boton.classList.contains('btRepetir') || onclick.includes('repetir');
    }

    function alHacerClic(evento) {
        const boton = evento.target.closest && evento.target.closest('button');
        if (!boton || !esBotonGenerarORepetir(boton)) return;

        const ejercicio = boton.closest('.ejercicio');
        if (!ejercicio) return;

        clearTimeout(timersHabilitar.get(ejercicio));
        const id = setTimeout(() => {
            timersHabilitar.delete(ejercicio);
            habilitarCorregir(ejercicio);
        }, CONFIG.ESPERA_HABILITAR_MS);
        timersHabilitar.set(ejercicio, id);
    }

    // =========================================================================
    // 6. DETECCIÓN DE CAPÍTULO Y DESCARGA DESDE GITHUB
    // =========================================================================
    function obtenerMetadatosCapitulo() {
        const re = /materias\/([a-zA-Z0-9_-]+)\/capitulos\/(capitulo\d+)/i;
        const fuentes = [...document.querySelectorAll('script[src]')].map(s => s.src).concat(location.pathname);
        for (const f of fuentes) {
            const m = f.match(re);
            if (m) return { materia: m[1].toLowerCase(), capitulo: m[2].toLowerCase(), num: m[2].replace(/\D/g, '') };
        }
        return null;
    }

    function extraerNumCapTitulo(titulo) {
        const m = sinTildes(titulo || '').match(/capitulo\s*(\d+)/i);
        return m ? m[1] : null;
    }

    function urlBaseRaw(meta) {
        const { GITHUB_USER, GITHUB_REPO, GITHUB_BRANCH } = CONFIG;
        return `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${meta.materia}`;
    }

    async function intentarDescargaDirecta(meta) {
        const base = urlBaseRaw(meta);
        const num = String(meta.num);
        const candidatos = [`${base}/${num}.html`, `${base}/${meta.capitulo}.html`, `${base}/${num.padStart(2, '0')}.html`];
        for (const url of candidatos) {
            try {
                const r = await fetch(url, { cache: 'no-store' });
                if (r.ok) return await r.text();
            } catch (e) {}
        }
        return null;
    }

    async function listarArchivosMateria(meta) {
        const { GITHUB_USER, GITHUB_REPO, GITHUB_BRANCH } = CONFIG;
        const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${meta.materia}?ref=${GITHUB_BRANCH}`;
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`No se encontró la carpeta "${meta.materia}" en GitHub (${resp.status})`);
        return resp.json();
    }

    function elegirArchivoCapitulo(archivos, num) {
        const reglas = [
            f => new RegExp(`^0*${num}\\.html?$`, 'i').test(f.name.trim()),
            f => new RegExp(`cap[ií]tulo[\\s_-]*0*${num}(?!\\d).*\\.html?$`, 'i').test(sinTildes(f.name).toLowerCase()),
            f => new RegExp(`(?:^|[^\\d])0*${num}\\.html?$`, 'i').test(f.name.trim())
        ];
        for (const regla of reglas) {
            const hallado = archivos.find(f => f.type === 'file' && regla(f));
            if (hallado) return hallado;
        }
        return null;
    }

    async function descargarArchivo(meta, archivo) {
        const url = archivo.download_url || `${urlBaseRaw(meta)}/${encodeURIComponent(archivo.name)}`;
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`Error al descargar "${archivo.name}" (${resp.status})`);
        return resp.text();
    }

    async function descargarHTMLDesdeGitHub(meta) {
        if (estado.cacheHTMLGitHub) return estado.cacheHTMLGitHub;

        const directo = await intentarDescargaDirecta(meta);
        if (directo) return (estado.cacheHTMLGitHub = directo);

        const archivos = await listarArchivosMateria(meta);
        const elegido = elegirArchivoCapitulo(archivos, String(meta.num));
        if (!elegido) throw new Error(`No hay archivo para el capítulo ${meta.num} en "${meta.materia}".`);

        return (estado.cacheHTMLGitHub = await descargarArchivo(meta, elegido));
    }

    // =========================================================================
    // 7. DOM DE EJERCICIOS
    // =========================================================================
    function obtenerNotaEjercicio(ej) {
        const inp = ej.querySelector('input.notas, input.itmostrar.notas');
        if (!inp) return 0;
        const val = parseFloat(inp.value || inp.getAttribute('value') || '0');
        return isNaN(val) ? 0 : val;
    }

    function obtenerEstadoBotones(ej) {
        const gen = ej.querySelector('.btGenerar');
        const rep = ej.querySelector('.btRepetir');
        const cor = ej.querySelector(SEL.CORREGIR);
        return {
            generarVisible: !!(gen && esVisible(gen)),
            repetirVisible: !!(rep && esVisible(rep)),
            corregirVisible: !!(cor && esVisible(cor))
        };
    }

    function encontrarEjercicioCorriendo() {
        const ejercicios = Array.from(document.querySelectorAll('div.ejercicio[id]'));
        const sinInicio = b => !b.generarVisible && !b.repetirVisible;

        const porCorregir = ejercicios.find(ej => {
            const b = obtenerEstadoBotones(ej);
            return sinInicio(b) && b.corregirVisible;
        });
        if (porCorregir) return porCorregir;

        return ejercicios.find(ej => sinInicio(obtenerEstadoBotones(ej)) && ej.hasAttribute('enunciado')) || null;
    }

    function buscarEjercicioResuelto(doc, ejActual) {
        const id = ejActual.id;
        const enunciado = ejActual.getAttribute('enunciado');
        return doc.querySelector(`div.ejercicio[id="${id}"][enunciado="${enunciado}"]`);
    }

    function textoInst(el) {
        const d = document.createElement('div');
        d.innerHTML = el.innerHTML.replace(/<br\s*[\/]?>/gi, '\n').replace(/<\/p>|<\/div>/gi, '\n');
        return d.textContent.replace(/\u200B/g, '').replace(/^\n+|\n+$/g, '');
    }

    // =========================================================================
    // 8. ACCIONES SOBRE BOTONES DEL EJERCICIO
    // =========================================================================
    async function clickCorregir(ej) {
        if (estado.cancelado) return false;
        const btn = habilitarCorregir(ej);
        if (!btn) return false;
        btn.click();
        await sleep(CONFIG.PAUSA_TRAS_CORREGIR_MS);
        return true;
    }

    async function clickYEsperarCambio(ej, boton) {
        const antes = ej.innerHTML;
        boton.click();
        await esperarHasta(() => ej.innerHTML !== antes, 2500);
        await sleep(150);
    }

    async function iniciarOReiniciar(ej, intento) {
        const gen = ej.querySelector('.btGenerar');
        const rep = ej.querySelector('.btRepetir');
        const usarGenerar = intento === 0 && gen && esVisible(gen) && !(rep && esVisible(rep));
        const boton = usarGenerar ? gen : rep;
        if (boton) await clickYEsperarCambio(ej, boton);
    }

    async function corregirYRepetir(ej) {
        await clickCorregir(ej);
        await esperarHasta(() => {
            const r = ej.querySelector('.btRepetir');
            return r && esVisible(r);
        }, 2000);

        const rep = ej.querySelector('.btRepetir');
        if (!rep || !esVisible(rep)) return false;

        await clickYEsperarCambio(ej, rep);
        habilitarCorregir(ej);
        return true;
    }

    // =========================================================================
    // 9. RESPUESTAS DIRECTAS DESDE EL OBJETO `capitulo` (sin comparar ni iterar)
    // =========================================================================
    const b64 = {
        d: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz<>",
        d4c(e) {
            let t, r, a = [], i = "";
            for (let o = 0; o < 4; o++) {
                t = this.d.indexOf(e[3 - o]);
                for (let j = 0; j < 6; j++) a.unshift((t >> j) & 1);
            }
            const bin = a.join("");
            for (let j = 0; j < 3; j++) {
                r = parseInt(bin.slice(8 * j, 8 * (j + 1)), 2);
                i += String.fromCharCode(r);
            }
            return i;
        },
        d4cf(e) {
            let t, r, a = [], i = "";
            for (let o = 0; o < 4; o++) {
                t = e[3 - o] ? this.d.indexOf(e[3 - o]) : 0;
                for (let j = 0; j < 6; j++) a.unshift((t >> j) & 1);
            }
            const bin = a.join("");
            for (let j = 0; j < 3; j++) {
                r = parseInt(bin.slice(8 * j, 8 * (j + 1)), 2);
                if (r !== 0) i += String.fromCharCode(r);
            }
            return i;
        },
        decode(e) {
            let t = 0, r = "";
            while (t < e.length - 4) {
                r += this.d4c(e.substring(t, t + 4));
                t += 4;
            }
            return r + this.d4cf(e.substring(t, t + 4));
        }
    };

    const limpiarComandosProfesor = t => t.replace(/_\^/g, '').replace(/_\$/g, '');

    function obtenerPreguntasEjercicio(ej) {
        const m = /^ejercicio(\d+)$/.exec(ej.id || '');
        if (!m || typeof capitulo === 'undefined' || !capitulo.ejercicios) return null;
        const data = capitulo.ejercicios[Number(m[1]) - 1];
        return (data && data.preguntas && data.preguntas[data.enunciado]) || null;
    }

    async function escribirLiteralDirecto(campo, texto) {
        campo.textContent = texto;
        dispararEventos(campo, ['input']);
        campo.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        dispararEventos(campo, ['change']);
        campo.blur();
        await sleep(20);
    }

    /** Tipo 4: campos literales (texto) */
    async function llenarTipoLiteral(p, literales, cursor) {
        for (const c of p.pregunta.campos) {
            const campo = literales[cursor.lit++];
            if (!campo) continue;
            await escribirLiteralDirecto(campo, limpiarComandosProfesor(b64.decode(c[0])));
        }
    }

    /** Tipos 2 y 3: arrastrar / dato (listas desplegables) */
    function llenarTipoSelector(p, selectores, cursor) {
        p.pregunta.correctas.forEach(c => {
            const campo = selectores[cursor.sel++];
            if (campo) campo.textContent = b64.decode(c);
        });
    }

    /** Tipo 0: selección simple (radio) */
    function marcarTipoRadio(p) {
        const visible = p.pregunta.visibles.find(v => v[0] === p.pregunta.correcta[0]);
        const radio = visible && document.getElementById(visible[1]);
        if (radio && !radio.checked) radio.click();
    }

    /** Tipo 1: selección múltiple (checkbox) */
    function marcarTipoChecks(p) {
        p.pregunta.forEach(opt => {
            const cb = document.getElementById(opt.id);
            if (cb && cb.checked !== (opt.tipo === 1)) cb.click();
        });
    }

    /** Devuelve true si el ejercicio tenía datos en `capitulo`. */
    async function llenarCamposDesdeCapitulo(ej) {
        const preguntas = obtenerPreguntasEjercicio(ej);
        if (!preguntas) return false;

        const literales = ej.querySelectorAll('.campo_literal');
        const selectores = ej.querySelectorAll(SEL.SELECTORES);
        const cursor = { lit: 0, sel: 0 };

        for (const p of preguntas) {
            if (estado.cancelado) return true;
            if (p.tipo === 4) await llenarTipoLiteral(p, literales, cursor);
            else if (p.tipo === 2 || p.tipo === 3) llenarTipoSelector(p, selectores, cursor);
            else if (p.tipo === 0) marcarTipoRadio(p);
            else if (p.tipo === 1) marcarTipoChecks(p);
        }
        return true;
    }

    /** Inputs de texto sueltos: solo si hay documento resuelto (GitHub/Local). */
    function llenarInputsTexto(ejActual, ejResuelto) {
        const src = ejResuelto.querySelectorAll(SEL.INPUTS_TEXTO);
        const live = ejActual.querySelectorAll(SEL.INPUTS_TEXTO);
        live.forEach((input, i) => {
            if (!src[i]) return;
            input.value = src[i].value || src[i].getAttribute('value') || '';
            dispararEventos(input, ['input', 'change']);
        });
    }

    // =========================================================================
    // 10. CALCULADORAS (CodeMirror)
    // =========================================================================
    const esDiagramaSrc = c => /gojsGraph\s*\(/.test(c.textContent);
    const esDiagramaVivo = c => !!c.querySelector('canvas') || /gojsGraph\s*\(/.test(c.textContent);

    async function escribirCelda(liveCalc, indice, texto) {
        if (!texto || estado.cancelado) return;
        const obtener = () => liveCalc.querySelectorAll('.CodeMirror')[indice];
        let liveCM = obtener();
        if (!liveCM) {
            await esperarHasta(obtener, 2000);
            liveCM = obtener();
        }
        if (liveCM && liveCM.CodeMirror) {
            const cm = liveCM.CodeMirror;
            cm.setValue(texto);
            dispararShiftEnter(cm.getInputField(), ['keydown']);
            await sleep(120);
        }
    }

    function instruccionesDe(calc) {
        return Array.from(calc.querySelectorAll('.instruccion')).map(textoInst);
    }

    function contarCeldasConContenido(calc) {
        const n = Array.from(calc.querySelectorAll('.CodeMirror'))
            .filter(cm => cm.CodeMirror && cm.CodeMirror.getValue().trim() !== '').length;
        return Math.max(1, n);
    }

    function planificarCalculadoras(liveNoDiag, srcNoDiag) {
        const plan = new Map();
        if (liveNoDiag.length === srcNoDiag.length) {
            liveNoDiag.forEach((c, j) => plan.set(c, instruccionesDe(srcNoDiag[j])));
            return plan;
        }
        const todas = srcNoDiag.flatMap(instruccionesDe).filter(t => t);
        const cupo = liveNoDiag.map(contarCeldasConContenido);
        liveNoDiag.forEach((c, j) =>
            plan.set(c, j === liveNoDiag.length - 1 ? todas.splice(0) : todas.splice(0, cupo[j])));
        return plan;
    }

    async function llenarCalculadoraNormal(liveCalc, textos) {
        for (let k = 0; k < textos.length; k++) await escribirCelda(liveCalc, k, textos[k]);
    }

    /** Devuelve { diagramaFallo } */
    async function llenarCalculadoras(ejActual, ejResuelto) {
        const live = Array.from(ejActual.querySelectorAll('.calculadora'));
        const src = Array.from(ejResuelto.querySelectorAll('.calculadora'));

        const srcDiag = src.filter(esDiagramaSrc);
        const srcNoDiag = src.filter(c => !esDiagramaSrc(c));
        const liveNoDiag = live.filter(c => !esDiagramaVivo(c));
        const plan = planificarCalculadoras(liveNoDiag, srcNoDiag);

        let diagramaFallo = false;
        let idxDiag = 0;
        for (const liveCalc of live) {
            if (estado.cancelado) return { diagramaFallo: false };
            if (esDiagramaVivo(liveCalc)) {
                const srcCalc = srcDiag[idxDiag++];
                if (!srcCalc) continue;
                if ((await procesarDiagrama(liveCalc, srcCalc)) === false) diagramaFallo = true;
            } else {
                await llenarCalculadoraNormal(liveCalc, plan.get(liveCalc) || []);
            }
        }
        return { diagramaFallo };
    }

    // =========================================================================
    // 11. DIAGRAMAS GOJS
    // =========================================================================
    function limpiarComodines(t) {
        if (typeof t !== 'string' || !t.includes('_(')) return t;
        return t.replace(/_\(([\s\S]*?)_\)/g, (m, inner) => inner.split('_|')[0].replace(/_/g, ''))
                .replace(/[ \t]{2,}/g, ' ').trim();
    }

    function extraerModeloGoJS(texto) {
        if (!texto) return null;
        const ini = texto.lastIndexOf('{"class":"go.GraphLinksModel"');
        if (ini === -1) return null;

        let prof = 0, enCadena = false, escape = false;
        for (let i = ini; i < texto.length; i++) {
            const ch = texto[i];
            if (enCadena) {
                if (escape) escape = false;
                else if (ch === '\\') escape = true;
                else if (ch === '"') enCadena = false;
                continue;
            }
            if (ch === '"') { enCadena = true; continue; }
            if (ch === '{') prof++;
            else if (ch === '}' && --prof === 0) {
                try { return JSON.parse(texto.slice(ini, i + 1)); } catch (e) { return null; }
            }
        }
        return null;
    }

    function diagramaDe(calc) {
        const cv = calc.querySelector('canvas');
        if (!cv || !window.go || !window.go.Diagram) return null;
        for (let el = cv; el; el = el.parentElement) {
            const d = window.go.Diagram.fromDiv(el);
            if (d) return d;
        }
        return null;
    }

    function diagramaEsCorrecto(calc) {
        const c = calc.cloneNode(true);
        c.querySelectorAll('.CodeMirror, .instruccion, textarea, canvas, svg').forEach(e => e.remove());
        const t = norm(c.textContent).toLowerCase();
        return /correcto/.test(t) && !/incorrecto/.test(t);
    }

    function quitarEnlaces(m) {
        const viejos = [...m.linkDataArray];
        if (m.removeLinkDataCollection) m.removeLinkDataCollection(viejos);
        else viejos.forEach(l => m.removeLinkData(l));
    }

    function aplicarNodos(m, nodos) {
        nodos.forEach(src => {
            const texto = limpiarComodines(src.text);
            const existente = m.findNodeDataForKey(src.key);
            if (existente) {
                if (src.text !== undefined) m.setDataProperty(existente, 'text', texto);
            } else {
                const copia = JSON.parse(JSON.stringify(src));
                copia.text = texto;
                m.addNodeData(copia);
            }
        });
    }

    function aplicarEnlaces(m, enlaces) {
        enlaces.forEach(l => {
            const copia = JSON.parse(JSON.stringify(l));
            if (typeof copia.text === 'string') copia.text = limpiarComodines(copia.text);
            m.addLinkData(copia);
        });
    }

    function inyectarModelo(d, modelo) {
        const m = d.model;
        d.startTransaction('InyeccionModelo');
        try {
            quitarEnlaces(m);
            aplicarNodos(m, modelo.nodeDataArray || []);
            aplicarEnlaces(m, modelo.linkDataArray || []);
            d.commitTransaction('InyeccionModelo');
            return true;
        } catch (e) {
            try { d.rollbackTransaction(); } catch (e2) {}
            return false;
        }
    }

    async function rellenarDiagramaComoTexto(liveCalc, srcCalc) {
        const textos = instruccionesDe(srcCalc).map(limpiarComodines);
        for (let k = 0; k < textos.length; k++) await escribirCelda(liveCalc, k, textos[k]);
    }

    async function verificarDiagrama(liveCalc) {
        let ok = await esperarHasta(() => diagramaEsCorrecto(liveCalc), 2500, 100);
        if (!ok && !estado.cancelado) {
            const cv = liveCalc.querySelector('canvas');
            dispararShiftEnter(cv);
            if (cv && cv.parentElement) dispararShiftEnter(cv.parentElement);
            ok = await esperarHasta(() => diagramaEsCorrecto(liveCalc), 3000, 100);
        }
        return ok;
    }

    async function procesarDiagrama(liveCalc, srcCalc) {
        const modelo = extraerModeloGoJS(srcCalc.textContent) || extraerModeloGoJS(liveCalc.textContent);
        if (!modelo) return null;

        await esperarHasta(() => diagramaDe(liveCalc), 2500);
        const d = diagramaDe(liveCalc);

        if (d && inyectarModelo(d, modelo)) {
            await sleep(60);
            dispararShiftEnter(liveCalc.querySelector('canvas'));
        } else {
            await rellenarDiagramaComoTexto(liveCalc, srcCalc);
        }

        return CONFIG.VERIFICAR_DIAGRAMA ? verificarDiagrama(liveCalc) : true;
    }

    // =========================================================================
    // 12. RELLENO COMPLETO DE UN EJERCICIO
    // =========================================================================
    /** ejResuelto puede ser null (modo directo): solo se llenan los campos desde `capitulo`. */
    async function rellenarContenidoEjercicio(ejActual, ejResuelto) {
        await llenarCamposDesdeCapitulo(ejActual);
        if (estado.cancelado || !ejResuelto) return { diagramaFallo: false };

        const { diagramaFallo } = await llenarCalculadoras(ejActual, ejResuelto);
        if (diagramaFallo) return { diagramaFallo: true };

        llenarInputsTexto(ejActual, ejResuelto);
        await sleep(100);
        return { diagramaFallo: false };
    }

    // =========================================================================
    // 13. INTERFAZ GRÁFICA
    // =========================================================================
    const ui = {};
    const ICONO_DESCARGA = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;

    function crearElemento(tag, estilos = {}, props = {}) {
        const el = document.createElement(tag);
        Object.assign(el, props);
        Object.assign(el.style, estilos);
        return el;
    }

    function crearSeccionInfo(texto) {
        return crearElemento('div', {
            background: '#1e293b', color: '#38bdf8', padding: '5px 8px', fontSize: '11px',
            fontWeight: '700', textAlign: 'center', border: '1px solid #334155',
            borderRadius: '0px', letterSpacing: '0.5px'
        }, { textContent: texto });
    }

    function crearSelectorModo() {
        const sel = crearElemento('select', {
            padding: '6px 12px', background: '#1e293b', color: '#e2e8f0',
            border: '1px solid #475569', borderRadius: '999px', fontSize: '11px',
            fontWeight: '500', cursor: 'pointer', outline: 'none'
        }, { title: 'Modo de inyección' });

        const valores = ['no_iniciados', 'iniciados', 'sin_corregir', 'todos'];
        const textos = ['Solo no iniciados', 'Solo iniciados (<100)', 'Sin corregir (en curso)', 'Todos'];
        valores.forEach((v, i) => sel.appendChild(crearElemento('option', {}, { value: v, textContent: textos[i] })));
        return sel;
    }

    function crearBotonGitHub() {
        return crearElemento('button', {
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '32px', height: '32px', background: '#2563eb', color: '#ffffff',
            border: 'none', borderRadius: '50%', cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(37, 99, 235, 0.4)', transition: 'all 0.2s ease', padding: '0'
        }, { innerHTML: ICONO_DESCARGA });
    }

    function crearBotonLocal() {
        return crearElemento('button', {
            padding: '6px 12px', background: '#334155', color: 'white', border: 'none',
            borderRadius: '999px', cursor: 'pointer', fontSize: '11px', fontWeight: '600'
        }, { textContent: 'Local' });
    }

    function crearBotonDirecto() {
        return crearElemento('button', {
            padding: '6px 12px', background: '#16a34a', color: 'white', border: 'none',
            borderRadius: '999px', cursor: 'pointer', fontSize: '11px', fontWeight: '600'
        }, { textContent: '⚡ Directo', title: 'Rellena desde los datos del capítulo (sin descargar)' });
    }

    function crearBotonCerrar() {
        return crearElemento('button', {
            width: '28px', height: '28px', background: '#ef4444', color: 'white', border: 'none',
            borderRadius: '50%', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }, { textContent: '✕' });
    }

    function crearPestana() {
        return crearElemento('button', {
            width: '16px', height: '36px', background: 'transparent', color: 'transparent',
            border: 'none', outline: 'none', borderRadius: '0px', cursor: 'pointer', opacity: '0', padding: '0'
        });
    }

    function crearPanelMenu() {
        return crearElemento('div', {
            display: 'none', flexDirection: 'column', gap: '8px',
            background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(6px)',
            padding: '10px 12px', borderRadius: '0px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
            borderRight: 'none', marginRight: '0'
        });
    }

    function crearInputArchivo() {
        return crearElemento('input', { display: 'none' },
            { className: 'tm-inyectado', type: 'file', accept: '.html,.htm' });
    }

    function construirUI() {
        const meta = obtenerMetadatosCapitulo();
        const etiqueta = meta ? `${meta.materia.toUpperCase()} · Cap ${meta.num}` : 'V35';

        const raiz = crearElemento('div', {
            position: 'fixed', bottom: '28px', right: '0', zIndex: '9999',
            display: 'flex', alignItems: 'center', fontFamily: 'system-ui, sans-serif'
        }, { className: 'tm-inyectado' });

        ui.panel = crearPanelMenu();
        ui.selectModo = crearSelectorModo();
        ui.btnGitHub = crearBotonGitHub();
        ui.btnLocal = crearBotonLocal();
        ui.btnDirecto = crearBotonDirecto();
        ui.btnCerrar = crearBotonCerrar();
        ui.btnPestana = crearPestana();
        ui.inputFile = crearInputArchivo();

        const fila = crearElemento('div', { display: 'flex', alignItems: 'center', gap: '6px' });
        fila.append(ui.selectModo, ui.btnDirecto, ui.btnGitHub, ui.btnLocal, ui.btnCerrar);
        ui.panel.append(crearSeccionInfo(etiqueta), fila);
        raiz.append(ui.panel, ui.btnPestana);

        document.body.appendChild(raiz);
        document.body.appendChild(ui.inputFile);
    }

    function alternarMenu() {
        estado.menuAbierto = !estado.menuAbierto;
        ui.panel.style.display = estado.menuAbierto ? 'flex' : 'none';
    }

    function mostrarProgreso(texto) {
        ui.btnGitHub.innerHTML = `<span style="font-size:10px; font-weight:bold;">${texto}</span>`;
    }

    function bloquearUI() {
        ui.btnGitHub.disabled = true;
        ui.btnLocal.disabled = true;
        ui.btnDirecto.disabled = true;
        ui.selectModo.disabled = true;
        ui.btnGitHub.style.opacity = '0.7';
        mostrarProgreso('...');
    }

    function resetearUI() {
        desactivarEscudoFoco();
        if (estado.cancelado) return;
        ui.btnGitHub.disabled = false;
        ui.btnLocal.disabled = false;
        ui.btnDirecto.disabled = false;
        ui.selectModo.disabled = false;
        ui.btnGitHub.innerHTML = ICONO_DESCARGA;
        ui.btnGitHub.style.opacity = '1';
    }

    // =========================================================================
    // 14. ORQUESTACIÓN: PREPARACIÓN Y VALIDACIÓN
    // =========================================================================
    function parsearHTML(texto) {
        try { return new DOMParser().parseFromString(texto, 'text/html'); }
        catch (e) { return null; }
    }

    /** Devuelve mensaje de error o null si todo bien. */
    function validarCapitulo(doc) {
        const meta = obtenerMetadatosCapitulo();
        const capDoc = extraerNumCapTitulo(doc.title);
        const capPag = extraerNumCapTitulo(document.title) || (meta && meta.num);
        if (capDoc && capPag && capDoc !== String(capPag)) {
            return `Error: Archivo de cap ${capDoc}, pero estás en cap ${capPag}.`;
        }
        return null;
    }

    // =========================================================================
    // 15. ORQUESTACIÓN: MODO "SIN CORREGIR (EN CURSO)"
    // =========================================================================
    const necesitaDocumento = ej => !!ej.querySelector('.calculadora');
    const resolverEjercicio = (doc, ej) => (doc ? buscarEjercicioResuelto(doc, ej) : null);
    const maxIntentosPara = doc => (doc ? CONFIG.MAX_INTENTOS : 1);

    async function intentarRellenarEnCurso(doc, ej) {
        const resuelto = resolverEjercicio(doc, ej);
        if (doc && necesitaDocumento(ej) && !resuelto) return false;
        const { diagramaFallo } = await rellenarContenidoEjercicio(ej, resuelto);
        return !diagramaFallo;
    }

    async function procesarModoEnCurso(doc) {
        const ej = encontrarEjercicioCorriendo();
        if (!ej) { showToast('No hay ningún ejercicio corriendo en este momento.', 'warning'); return; }

        const max = maxIntentosPara(doc);
        for (let intento = 0; intento < max; intento++) {
            if (estado.cancelado) return;
            mostrarProgreso(intento + 1);

            if (await intentarRellenarEnCurso(doc, ej)) return;

            if (intento < max - 1 && !estado.cancelado) {
                if (!(await corregirYRepetir(ej))) break;
            }
        }
        showToast('No se encontró coincidencia por ID en curso.', 'warning');
    }

    // =========================================================================
    // 16. ORQUESTACIÓN: MODOS MASIVOS (no_iniciados / iniciados / todos)
    // =========================================================================
    function debeProcesarEjercicio(modo, ej) {
        const b = obtenerEstadoBotones(ej);
        if (modo === 'no_iniciados') return !b.repetirVisible && b.generarVisible;
        if (modo === 'iniciados') return b.repetirVisible && obtenerNotaEjercicio(ej) < 100;
        return b.generarVisible || b.repetirVisible;
    }

    /**
     * Sin documento: una sola pasada (los datos salen de `capitulo`).
     * Con documento: solo reintenta si el ejercicio tiene calculadoras/diagramas
     * y aún no coincide con el enunciado resuelto.
     */
    async function procesarEjercicio(doc, ej) {
        const max = maxIntentosPara(doc);
        for (let intento = 0; intento < max; intento++) {
            if (estado.cancelado) return false;

            await iniciarOReiniciar(ej, intento);
            if (estado.cancelado) return false;

            const resuelto = resolverEjercicio(doc, ej);
            if (doc && necesitaDocumento(ej) && !resuelto) { await clickCorregir(ej); continue; }

            const { diagramaFallo } = await rellenarContenidoEjercicio(ej, resuelto);
            await clickCorregir(ej);

            if (diagramaFallo && intento < max - 1) continue;
            return true;
        }
        return false;
    }

    async function procesarModoMasivo(doc, modo) {
        const ejercicios = Array.from(document.querySelectorAll('div.ejercicio[id]'));
        let procesados = 0, omitidos = 0;

        for (let i = 0; i < ejercicios.length; i++) {
            if (estado.cancelado) return;
            const ej = ejercicios[i];
            if (!ej.id) continue;

            if (!debeProcesarEjercicio(modo, ej)) { omitidos++; continue; }

            mostrarProgreso(i + 1);
            if (await procesarEjercicio(doc, ej)) procesados++;
        }

        if (procesados === 0 && omitidos > 0) showToast(`No se inyectó nada: ${omitidos} omitidos por filtros.`, 'info');
        else if (procesados === 0) showToast(doc ? 'No se encontró coincidencia por ID en el archivo.' : 'No hay ejercicios para procesar.', 'warning');
    }

    // =========================================================================
    // 17. ORQUESTADOR PRINCIPAL
    // =========================================================================
    /** doc = null → modo directo (solo datos de `capitulo`). */
    async function ejecutarInyeccion(doc) {
        activarEscudoFoco();
        const modo = ui.selectModo.value;

        if (modo === 'sin_corregir') await procesarModoEnCurso(doc);
        else await procesarModoMasivo(doc, modo);

        if (!estado.cancelado) resetearUI();
    }

    async function ejecutarInyeccionConHTML(htmlTexto) {
        const doc = parsearHTML(htmlTexto);
        if (!doc) { showToast('Error: HTML inválido.', 'error'); return resetearUI(); }

        const error = validarCapitulo(doc);
        if (error) { showToast(error, 'error'); return resetearUI(); }

        await ejecutarInyeccion(doc);
    }

    // =========================================================================
    // 18. HANDLERS DE BOTONES
    // =========================================================================
    async function alClickGitHub() {
        if (ui.btnGitHub.disabled) return;
        const meta = obtenerMetadatosCapitulo();
        if (!meta) { showToast('Error: Metadatos no detectados.', 'error'); return; }

        bloquearUI();
        try {
            const html = await descargarHTMLDesdeGitHub(meta);
            await ejecutarInyeccionConHTML(html);
        } catch (err) {
            showToast(err.message || 'Error al conectar con GitHub.', 'error');
            resetearUI();
        }
    }

    async function alClickDirecto() {
        if (ui.btnDirecto.disabled) return;
        if (typeof capitulo === 'undefined') { showToast('Error: objeto "capitulo" no cargado.', 'error'); return; }

        bloquearUI();
        try {
            await ejecutarInyeccion(null);
        } catch (err) {
            showToast(err.message || 'Error en modo directo.', 'error');
            resetearUI();
        }
    }

    function alClickLocal() {
        if (!ui.btnLocal.disabled) ui.inputFile.click();
    }

    function alElegirArchivo() {
        const file = ui.inputFile.files[0];
        if (!file) return;

        bloquearUI();
        const reader = new FileReader();
        reader.onload = async e => {
            ui.inputFile.value = '';
            await ejecutarInyeccionConHTML(e.target.result);
        };
        reader.readAsText(file);
    }

    // =========================================================================
    // 19. INICIALIZACIÓN
    // =========================================================================
    function conectarEventos() {
        document.addEventListener('click', interceptarGuardar, true);
        document.addEventListener('click', alHacerClic, true);
        ui.btnCerrar.addEventListener('click', limpiarRastro);
        ui.btnPestana.addEventListener('click', alternarMenu);
        ui.btnDirecto.addEventListener('click', alClickDirecto);
        ui.btnGitHub.addEventListener('click', alClickGitHub);
        ui.btnLocal.addEventListener('click', alClickLocal);
        ui.inputFile.addEventListener('change', alElegirArchivo);
    }

    function iniciar() {
        envolverSavePage();
        construirUI();
        conectarEventos();
    }

    iniciar();
})();
