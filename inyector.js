// ==UserScript==
// @name         Inyector Maestro V33.0 (Intercepción Local de Enunciados)
// @namespace    http://tampermonkey.net/
// @version      33.0
// @description  Descarga desde GitHub (mael-sysm/cap). Panel rectangular, escudo anti-foco, y Motor de Intercepción Síncrona que hackea Math.random para elegir la variante al instante sin iterar.
// @author       mercz d
// @match        https://cursosabiertos.usfx.bo/materias/*/capitulos/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    if (!document.querySelector('.ejercicio')) return;

    // =========================================================================
    // CONFIGURACIÓN DEL REPOSITORIO GITHUB
    // =========================================================================
    const GITHUB_USER   = 'mael-sysm';
    const GITHUB_REPO   = 'cap';
    const GITHUB_BRANCH = 'main';

    const VERIFICAR_DIAGRAMA = true;

    let cancelado = false;
    let cacheHTMLGitHub = null;

    // =========================================================================
    // ESCUDO ANTI-ROBO DE FOCO Y SCROLL
    // =========================================================================
    const focusOriginal = HTMLElement.prototype.focus;
    const scrollOriginal = Element.prototype.scrollIntoView;
    const windowScrollTo = window.scrollTo;
    let bloqueoFocoActivo = false;

    function activarEscudoFoco() {
        if (bloqueoFocoActivo) return;
        bloqueoFocoActivo = true;
        const posX = window.scrollX;
        const posY = window.scrollY;

        HTMLElement.prototype.focus = function () {};
        Element.prototype.scrollIntoView = function () {};
        window.scrollTo = function () { return windowScrollTo.call(window, posX, posY); };
    }

    function desactivarEscudoFoco() {
        if (!bloqueoFocoActivo) return;
        bloqueoFocoActivo = false;
        HTMLElement.prototype.focus = focusOriginal;
        Element.prototype.scrollIntoView = scrollOriginal;
        window.scrollTo = windowScrollTo;
    }

    // =========================================================================
    // MÓDULO 1: AUTO-DESBLOQUEADOR Y LIMPIEZA AL GUARDAR
    // =========================================================================
    const ESPERA_MS = 300;
    const timers = new Map();
    const KB_KEY = 'tm_kb_opciones_' + location.pathname;

    function limpiarRastro() {
        cancelado = true;
        desactivarEscudoFoco();
        document.removeEventListener('click', alHacerClic, true);
        document.removeEventListener('click', interceptarGuardar, true);
        timers.forEach(id => clearTimeout(id));
        timers.clear();
        try { localStorage.removeItem(KB_KEY); } catch (e) {}
        document.querySelectorAll('.tm-inyectado').forEach(el => el.remove());
    }

    function interceptarGuardar(evento) {
        const btnGuardar = evento.target.closest && evento.target.closest('#btGuardar, button[onclick*="savePage"]');
        if (btnGuardar) limpiarRastro();
    }
    document.addEventListener('click', interceptarGuardar, true);

    if (typeof window.savePage === 'function' && !window.savePage._envuelto) {
        const saveOriginal = window.savePage;
        const reemplazo = function () {
            limpiarRastro();
            return saveOriginal.apply(this, arguments);
        };
        reemplazo._envuelto = true;
        window.savePage = reemplazo;
    }

    function alHacerClic(evento) {
        const boton = evento.target.closest && evento.target.closest('button');
        if (!boton) return;

        const onclick = boton.getAttribute('onclick') || '';
        const esGenerar = boton.classList.contains('btGenerar') || onclick.includes('generar');
        const esRepetir = boton.classList.contains('btRepetir') || onclick.includes('repetir');
        if (!esGenerar && !esRepetir) return;

        const ejercicio = boton.closest('.ejercicio');
        if (!ejercicio) return;

        clearTimeout(timers.get(ejercicio));
        const id = setTimeout(() => {
            timers.delete(ejercicio);
            const corregir = ejercicio.querySelector('#btCorregir, .btCorregir');
            if (corregir) {
                corregir.removeAttribute('disabled');
                corregir.disabled = false;
            }
        }, ESPERA_MS);
        timers.set(ejercicio, id);
    }
    document.addEventListener('click', alHacerClic, true);

    // =========================================================================
    // MÓDULO 2: DETECCIÓN Y DESCARGA GITHUB
    // =========================================================================
    function obtenerMetadatosCapitulo() {
        for (const s of document.querySelectorAll('script[src]')) {
            const m = s.src.match(/materias\/([a-zA-Z0-9_-]+)\/capitulos\/(capitulo\d+)/i);
            if (m) return { materia: m[1].toLowerCase(), capitulo: m[2].toLowerCase(), num: m[2].replace(/\D/g, '') };
        }
        const mUrl = location.pathname.match(/materias\/([a-zA-Z0-9_-]+)\/capitulos\/(capitulo\d+)/i);
        if (mUrl) return { materia: mUrl[1].toLowerCase(), capitulo: mUrl[2].toLowerCase(), num: mUrl[2].replace(/\D/g, '') };
        return null;
    }

    async function descargarHTMLDesdeGitHub(meta) {
        if (cacheHTMLGitHub) return cacheHTMLGitHub;
        const baseRaw = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${meta.materia}`;
        const num = String(meta.num);
        const candidatos = [`${baseRaw}/${num}.html`, `${baseRaw}/${meta.capitulo}.html`, `${baseRaw}/${num.padStart(2, '0')}.html`];
        
        for (const url of candidatos) {
            try {
                const r = await fetch(url, { cache: 'no-store' });
                if (r.ok) { cacheHTMLGitHub = await r.text(); return cacheHTMLGitHub; }
            } catch (e) {}
        }
        
        const apiUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${meta.materia}?ref=${GITHUB_BRANCH}`;
        const respApi = await fetch(apiUrl, { cache: 'no-store' });
        if (!respApi.ok) throw new Error(`No se encontró la carpeta en GitHub.`);
        
        const archivos = await respApi.json();
        const limpiar = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        
        const elegidos = archivos.filter(f => f.type === 'file' && (new RegExp(`^0*${num}\\.html?$`, 'i').test(f.name.trim()) || new RegExp(`cap[ií]tulo[\\s_-]*0*${num}(?!\\d).*\\.html?$`, 'i').test(limpiar(f.name))));
        if (elegidos.length === 0) throw new Error(`No hay archivo para el capítulo ${num}.`);
        
        const respHtml = await fetch(elegidos[0].download_url, { cache: 'no-store' });
        if (!respHtml.ok) throw new Error(`Error al descargar.`);
        
        cacheHTMLGitHub = await respHtml.text();
        return cacheHTMLGitHub;
    }

    // =========================================================================
    // MÓDULO 3: UTILIDADES Y DOM
    // =========================================================================
    function showToast(message, type = 'info') {
        if (cancelado) return;
        const toast = document.createElement('div');
        toast.className = 'tm-inyectado';
        const colors = { info: '#3b82f6', success: '#16a34a', error: '#ef4444', warning: '#f59e0b' };
        toast.textContent = message;
        Object.assign(toast.style, {
            position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%) translateY(100px)',
            background: colors[type] || colors.info, color: 'white', padding: '12px 24px', borderRadius: '0px',
            fontFamily: 'system-ui', fontSize: '14px', fontWeight: '500',
            boxShadow: '0 4px 15px rgba(0,0,0,0.2)', zIndex: '10000', opacity: '0', transition: 'all 0.3s'
        });
        document.body.appendChild(toast);
        requestAnimationFrame(() => { toast.style.transform = 'translateX(-50%) translateY(0)'; toast.style.opacity = '1'; });
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
    }

    function extraerNumCapTitulo(titulo) {
        const m = (titulo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/capitulo\s*(\d+)/i);
        return m ? m[1] : null;
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    async function esperarHasta(cond, max = 2000, paso = 40) {
        const fin = Date.now() + max;
        while (Date.now() < fin) {
            if (cancelado) return false;
            try { if (cond()) return true; } catch (e) {}
            await sleep(paso);
        }
        return false;
    }

    const SEL_CAMPOS = '.campo_literal, .campo_arrastrar, .campo_dato';
    const SEL_TODO   = SEL_CAMPOS + ', p.opcionMultiple';
    const norm = t => (t || '').replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();
    const esVisible = el => !!(el && (el.offsetParent || el.getClientRects().length));

    function obtenerNotaEjercicio(ej) {
        const inp = ej.querySelector('input.notas, input.itmostrar.notas');
        if (!inp) return 0;
        const val = parseFloat(inp.value || inp.getAttribute('value') || '0');
        return isNaN(val) ? 0 : val;
    }

    function encontrarEjercicioCorriendo() {
        const ejercicios = Array.from(document.querySelectorAll('div.ejercicio[id]'));
        for (const ej of ejercicios) {
            const btnCor = ej.querySelector('#btCorregir, .btCorregir');
            if (btnCor && esVisible(btnCor) && !esVisible(ej.querySelector('.btGenerar')) && !esVisible(ej.querySelector('.btRepetir'))) return ej;
        }
        return ejercicios.find(ej => ej.hasAttribute('enunciado') && !esVisible(ej.querySelector('.btGenerar')) && !esVisible(ej.querySelector('.btRepetir'))) || null;
    }

    function textoInst(el) {
        const d = document.createElement('div');
        d.innerHTML = el.innerHTML.replace(/<br\s*[\/]?>|<\/p>|<\/div>/gi, '\n');
        return d.textContent.replace(/\u200B/g, '').replace(/^\n+|\n+$/g, '');
    }

    const conocimiento = new Map();
    try { JSON.parse(localStorage.getItem(KB_KEY) || '[]').forEach(([k, v]) => conocimiento.set(k, v)); } catch (e) {}
    const guardarKB = () => { if (!cancelado) try { localStorage.setItem(KB_KEY, JSON.stringify([...conocimiento])); } catch (e) {} };
    const textoOpcion = p => norm((p.querySelector('label') || {}).textContent);

    function llenarOpciones(ej) {
        ej.querySelectorAll('p.opcionMultiple').forEach(p => {
            const inp = p.querySelector('input');
            if (inp && conocimiento.get(textoOpcion(p)) === true && !inp.checked) inp.click();
        });
    }

    async function elegirOpcion(campo, respuesta) {
        const SEL_POPUP = 'div, li, span, a, p, td';
        const buscar = () => Array.from(document.body.querySelectorAll(SEL_POPUP)).filter(el =>
            el !== campo && !campo.contains(el) && !el.closest('.CodeMirror') && !el.closest('.tm-inyectado') &&
            norm(el.textContent) === respuesta && esVisible(el) && !Array.from(el.children).some(h => norm(h.textContent) === respuesta));

        const antes = new Set(buscar());
        campo.click();
        await esperarHasta(() => buscar().some(el => !antes.has(el)), 1500);
        const nuevas = buscar().filter(el => !antes.has(el));
        if (nuevas.length) {
            ['mousedown', 'mouseup', 'click'].forEach(t => nuevas[0].dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true })));
            await esperarHasta(() => norm(campo.textContent) === respuesta, 800);
        }
        if (norm(campo.textContent) !== respuesta) {
            campo.textContent = respuesta;
            campo.dispatchEvent(new Event('input', { bubbles: true }));
            campo.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    async function escribirCelda(liveCalc, indice, texto) {
        if (!texto || cancelado) return;
        let liveCM = liveCalc.querySelectorAll('.CodeMirror')[indice];
        if (!liveCM) { await esperarHasta(() => liveCalc.querySelectorAll('.CodeMirror')[indice], 2000); liveCM = liveCalc.querySelectorAll('.CodeMirror')[indice]; }
        if (liveCM && liveCM.CodeMirror) {
            liveCM.CodeMirror.setValue(texto);
            liveCM.CodeMirror.getInputField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true, bubbles: true }));
            await sleep(120);
        }
    }

    // =========================================================================
    // MÓDULO 4: DIAGRAMAS GOJS (Simplificado)
    // =========================================================================
    function limpiarComodines(t) { return (typeof t !== 'string' || !t.includes('_(')) ? t : t.replace(/_\(([\s\S]*?)_\)/g, (m, inner) => inner.split('_|')[0].replace(/_/g, '')).replace(/[ \t]{2,}/g, ' ').trim(); }
    function extraerModeloGoJS(texto) {
        if (!texto) return null;
        const ini = texto.lastIndexOf('{"class":"go.GraphLinksModel"');
        if (ini === -1) return null;
        let prof = 0, enCadena = false, escape = false;
        for (let i = ini; i < texto.length; i++) {
            const ch = texto[i];
            if (enCadena) { escape = (ch === '\\' && !escape); if (ch === '"' && !escape) enCadena = false; continue; }
            if (ch === '"') enCadena = true;
            else if (ch === '{') prof++;
            else if (ch === '}') { prof--; if (prof === 0) { try { return JSON.parse(texto.slice(ini, i + 1)); } catch (e) { return null; } } }
        }
        return null;
    }
    const esDiagramaSrc  = c => /gojsGraph\s*\(/.test(c.textContent);
    const esDiagramaVivo = c => !!c.querySelector('canvas') || /gojsGraph\s*\(/.test(c.textContent);
    function diagramaDe(calc) { const cv = calc.querySelector('canvas'); if (!cv || !window.go || !window.go.Diagram) return null; for (let el = cv; el; el = el.parentElement) { const d = window.go.Diagram.fromDiv(el); if (d) return d; } return null; }
    function correctoEn(calc) { const c = calc.cloneNode(true); c.querySelectorAll('.CodeMirror, .instruccion, textarea, canvas, svg').forEach(e => e.remove()); const t = norm(c.textContent).toLowerCase(); return /correcto/.test(t) && !/incorrecto/.test(t); }
    function shiftEnterEn(el) { if (el) ['keydown', 'keyup'].forEach(tipo => el.dispatchEvent(new KeyboardEvent(tipo, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true, bubbles: true }))); }

    async function procesarDiagrama(liveCalc, srcCalc) {
        const modelo = extraerModeloGoJS(srcCalc.textContent) || extraerModeloGoJS(liveCalc.textContent);
        if (!modelo) return null;
        await esperarHasta(() => diagramaDe(liveCalc), 2500);
        const d = diagramaDe(liveCalc);
        if (d) {
            d.startTransaction('Iny');
            try {
                const env = [...d.model.linkDataArray];
                if (d.model.removeLinkDataCollection) d.model.removeLinkDataCollection(env); else env.forEach(l => d.model.removeLinkData(l));
                (modelo.nodeDataArray || []).forEach(src => { const texto = limpiarComodines(src.text); const nodo = d.model.findNodeDataForKey(src.key); if (nodo) { if (src.text !== undefined) d.model.setDataProperty(nodo, 'text', texto); } else { const copia = JSON.parse(JSON.stringify(src)); copia.text = texto; d.model.addNodeData(copia); } });
                (modelo.linkDataArray || []).forEach(l => { const copia = JSON.parse(JSON.stringify(l)); if (typeof copia.text === 'string') copia.text = limpiarComodines(copia.text); d.model.addLinkData(copia); });
                d.commitTransaction('Iny'); await sleep(60); shiftEnterEn(liveCalc.querySelector('canvas'));
            } catch (e) { d.rollbackTransaction(); }
        } else {
            const textos = Array.from(srcCalc.querySelectorAll('.instruccion')).map(textoInst).map(limpiarComodines);
            for (let k = 0; k < textos.length; k++) await escribirCelda(liveCalc, k, textos[k]);
        }
        if (!VERIFICAR_DIAGRAMA) return true;
        let ok = await esperarHasta(() => correctoEn(liveCalc), 2500, 100);
        if (!ok && !cancelado) { shiftEnterEn(liveCalc.querySelector('canvas')); ok = await esperarHasta(() => correctoEn(liveCalc), 3000, 100); }
        return ok;
    }

    // =========================================================================
    // FUNCIÓN DE RELLENO
    // =========================================================================
    async function rellenarContenidoEjercicio(ejActual, ejResuelto) {
        const tieneCampos = ejActual.querySelector(SEL_TODO) !== null;
        const liveCalculadoras = Array.from(ejActual.querySelectorAll('.calculadora'));
        const sourceCalculadoras = Array.from(ejResuelto.querySelectorAll('.calculadora'));
        const srcDiag = sourceCalculadoras.filter(esDiagramaSrc);
        const srcNoDiag = sourceCalculadoras.filter(c => !esDiagramaSrc(c));
        const liveNoDiag = liveCalculadoras.filter(c => !esDiagramaVivo(c));

        const planPorCalc = new Map();
        if (liveNoDiag.length === srcNoDiag.length) {
            liveNoDiag.forEach((c, j) => planPorCalc.set(c, Array.from(srcNoDiag[j].querySelectorAll('.instruccion')).map(textoInst)));
        } else {
            const todas = srcNoDiag.flatMap(c => Array.from(c.querySelectorAll('.instruccion')).map(textoInst)).filter(t => t);
            const cupo = liveNoDiag.map(c => Math.max(1, Array.from(c.querySelectorAll('.CodeMirror')).filter(cm => cm.CodeMirror && cm.CodeMirror.getValue().trim() !== '').length));
            liveNoDiag.forEach((c, j) => planPorCalc.set(c, j === liveNoDiag.length - 1 ? todas.splice(0) : todas.splice(0, cupo[j])));
        }

        let diagramaFallo = false;
        let idxDiag = 0;
        for (const liveCalc of liveCalculadoras) {
            if (cancelado) return { diagramaFallo: false };
            if (esDiagramaVivo(liveCalc)) {
                if (srcDiag[idxDiag]) { if (await procesarDiagrama(liveCalc, srcDiag[idxDiag++]) === false) diagramaFallo = true; }
            } else {
                const textos = planPorCalc.get(liveCalc) || [];
                for (let k = 0; k < textos.length; k++) await escribirCelda(liveCalc, k, textos[k]);
            }
        }
        if (diagramaFallo) return { diagramaFallo: true };

        if (tieneCampos && !cancelado) {
            const srcLit = ejResuelto.querySelectorAll('.campo_literal');
            const liveLit = ejActual.querySelectorAll('.campo_literal');
            for (let k = 0; k < liveLit.length; k++) {
                if (!srcLit[k] || cancelado) continue;
                liveLit[k].textContent = norm(srcLit[k].textContent);
                ['input', 'change'].forEach(e => liveLit[k].dispatchEvent(new Event(e, { bubbles: true })));
                await sleep(20);
            }
            const SEL_SEL = '.campo_arrastrar, .campo_dato';
            const srcSel = Array.from(ejResuelto.querySelectorAll(SEL_SEL));
            const liveSel = Array.from(ejActual.querySelectorAll(SEL_SEL));
            const claveFila = c => { const td = c.closest('tr') && c.closest('tr').firstElementChild; return td && !td.contains(c) ? norm(td.textContent) : null; };
            for (let k = 0; k < liveSel.length; k++) {
                if (cancelado) return { diagramaFallo: false };
                let origen = srcSel.find(c => claveFila(c) === claveFila(liveSel[k])) || srcSel[k];
                if (origen) await elegirOpcion(liveSel[k], norm(origen.textContent));
            }
            ejActual.querySelectorAll('p.opcionMultiple').forEach(p => {
                const inp = p.querySelector('input');
                const quiere = conocimiento.get(textoOpcion(p));
                if (inp && quiere !== undefined && inp.checked !== quiere) inp.click();
            });
        }
        const sourceInputs = ejResuelto.querySelectorAll('input[type="text"]:not(.notas):not(.ittiempo)');
        ejActual.querySelectorAll('input[type="text"]:not(.notas):not(.ittiempo)').forEach((input, index) => {
            if (sourceInputs[index]) {
                input.value = sourceInputs[index].value || sourceInputs[index].getAttribute('value') || '';
                ['input', 'change'].forEach(e => input.dispatchEvent(new Event(e, { bubbles: true })));
            }
        });
        await sleep(100);
        return { diagramaFallo: false };
    }

    // =========================================================================
    // MÓDULO 5: INTERFAZ GRÁFICA INVISIBLE
    // =========================================================================
    const metaActual = obtenerMetadatosCapitulo();
    const etiquetaCap = metaActual ? `${metaActual.materia.toUpperCase()} · Cap ${metaActual.num}` : 'V33.0';

    const contenedorRaiz = document.createElement('div');
    contenedorRaiz.className = 'tm-inyectado';
    Object.assign(contenedorRaiz.style, { position: 'fixed', bottom: '28px', right: '0', zIndex: '9999', display: 'flex', alignItems: 'center', fontFamily: 'system-ui' });

    const panelMenu = document.createElement('div');
    Object.assign(panelMenu.style, { display: 'none', flexDirection: 'column', gap: '8px', background: 'rgba(15, 23, 42, 0.95)', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.15)', borderRight: 'none' });

    const seccionInfo = document.createElement('div');
    seccionInfo.textContent = etiquetaCap;
    Object.assign(seccionInfo.style, { background: '#1e293b', color: '#38bdf8', padding: '5px 8px', fontSize: '11px', fontWeight: '700', textAlign: 'center', border: '1px solid #334155' });

    const filaControles = document.createElement('div');
    Object.assign(filaControles.style, { display: 'flex', alignItems: 'center', gap: '6px' });

    const selectModo = document.createElement('select');
    Object.assign(selectModo.style, { padding: '6px 12px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #475569', borderRadius: '999px', fontSize: '11px', fontWeight: '500', outline: 'none' });
    ['Solo no iniciados', 'Solo iniciados (<100)', 'Sin corregir (en curso)', 'Todos'].forEach((t, i) => { const o = document.createElement('option'); o.value = ['no_iniciados', 'iniciados', 'sin_corregir', 'todos'][i]; o.textContent = t; selectModo.appendChild(o); });

    const btnGitHub = document.createElement('button');
    const iconoDescarga = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
    btnGitHub.innerHTML = iconoDescarga;
    Object.assign(btnGitHub.style, { width: '32px', height: '32px', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' });

    const btnLocal = document.createElement('button');
    btnLocal.textContent = 'Local';
    Object.assign(btnLocal.style, { padding: '6px 12px', background: '#334155', color: 'white', border: 'none', borderRadius: '999px', cursor: 'pointer', fontSize: '11px', fontWeight: '600' });

    const btnCerrar = document.createElement('button');
    btnCerrar.textContent = '✕';
    Object.assign(btnCerrar.style, { width: '28px', height: '28px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' });
    btnCerrar.addEventListener('click', limpiarRastro);

    const btnPestana = document.createElement('button');
    Object.assign(btnPestana.style, { width: '16px', height: '36px', background: 'transparent', color: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', opacity: '0' });
    let menuAbierto = false;
    btnPestana.addEventListener('click', () => { menuAbierto = !menuAbierto; panelMenu.style.display = menuAbierto ? 'flex' : 'none'; });

    filaControles.append(selectModo, btnGitHub, btnLocal, btnCerrar);
    panelMenu.append(seccionInfo, filaControles);
    contenedorRaiz.append(panelMenu, btnPestana);
    document.body.appendChild(contenedorRaiz);

    const inputFile = document.createElement('input');
    inputFile.type = 'file'; inputFile.accept = '.html,.htm'; inputFile.style.display = 'none';
    document.body.appendChild(inputFile);

    function resetearBtn() {
        desactivarEscudoFoco();
        if (cancelado) return;
        btnGitHub.disabled = btnLocal.disabled = selectModo.disabled = false;
        btnGitHub.innerHTML = iconoDescarga; btnGitHub.style.opacity = '1';
    }

    // =========================================================================
    // MÓDULO 6: MOTOR CENTRAL DE INYECCIÓN (INTERCEPCIÓN SÍNCRONA)
    // =========================================================================
    async function ejecutarInyeccionConHTML(htmlTexto) {
        activarEscudoFoco();
        const modo = selectModo.value;
        let doc;
        try { doc = new DOMParser().parseFromString(htmlTexto, 'text/html'); } catch (err) { showToast('Error: HTML inválido.', 'error'); resetearBtn(); return; }

        doc.querySelectorAll('p.opcionMultiple').forEach(p => { const inp = p.querySelector('input'); if (inp) conocimiento.set(textoOpcion(p), inp.checked || inp.hasAttribute('checked')); });
        guardarKB();

        if (modo === 'sin_corregir') {
            const ejActivo = encontrarEjercicioCorriendo();
            if (!ejActivo) { showToast('No hay ejercicio corriendo.', 'warning'); resetearBtn(); return; }
            let ejResuelto = doc.querySelector(`div.ejercicio[id="${ejActivo.id}"][enunciado="${ejActivo.getAttribute('enunciado')}"]`);
            if (ejResuelto) {
                const { diagramaFallo } = await rellenarContenidoEjercicio(ejActivo, ejResuelto);
                if (!diagramaFallo) { resetearBtn(); return; }
            }
            showToast('El ejercicio en curso no coincide con el archivo descargado.', 'warning');
            resetearBtn(); return;
        }

        const liveEjercicios = Array.from(document.querySelectorAll('div.ejercicio[id]'));
        let reemplazados = 0; let omitidos = 0;

        for (let i = 0; i < liveEjercicios.length; i++) {
            if (cancelado) return;
            const ejActual = liveEjercicios[i];
            const id = ejActual.id;
            if (!id) continue;

            const btnGenInicial = ejActual.querySelector('.btGenerar');
            const btnRepInicial = ejActual.querySelector('.btRepetir');
            const tieneRepetir = !!(btnRepInicial && esVisible(btnRepInicial));
            const tieneGenerar = !!(btnGenInicial && esVisible(btnGenInicial));
            const notaActual = obtenerNotaEjercicio(ejActual);

            if (modo === 'no_iniciados' && (tieneRepetir || !tieneGenerar)) { omitidos++; continue; }
            if (modo === 'iniciados' && (!tieneRepetir || notaActual >= 100)) { omitidos++; continue; }
            if (modo === 'todos' && !tieneGenerar && !tieneRepetir) { omitidos++; continue; }

            const resueltos = Array.from(doc.querySelectorAll(`div.ejercicio[id="${id}"]`));
            if (resueltos.length === 0) continue; 
            const enunciadosValidos = resueltos.map(e => e.getAttribute('enunciado'));

            btnGitHub.innerHTML = `<span style="font-size:10px; font-weight:bold;">${i + 1}</span>`;

            // === HACK: SECUESTRO DE ALEATORIEDAD SÍNCRONO ===
            const botonAccion = (tieneGenerar && !tieneRepetir) ? btnGenInicial : btnRepInicial;
            let interceptadoExitosamente = false;
            let ejResuelto = null;
            
            if (botonAccion) {
                const originalRandom = Math.random;
                let valorHack = 0.0;
                Math.random = function() { return valorHack; };

                // Hacemos 30 clics en 1 milisegundo (el navegador no parpadea ni lo dibuja)
                for (let intento = 0; intento < 30; intento++) {
                    const act = ejActual.getAttribute('enunciado');
                    if (enunciadosValidos.includes(act)) {
                        ejResuelto = resueltos.find(e => e.getAttribute('enunciado') === act);
                        interceptadoExitosamente = true;
                        break;
                    }
                    valorHack = (intento % 20) * 0.049; // Modulamos de 0.0 a 0.98 para forzar variantes locales
                    botonAccion.click(); // Síncrono
                }
                Math.random = originalRandom; // Devolvemos a la normalidad el navegador
            }

            if (interceptadoExitosamente && ejResuelto) {
                // Pequeña pausa para que CodeMirror / Canvas terminen de nacer post-hack
                await sleep(400); 
                const { diagramaFallo } = await rellenarContenidoEjercicio(ejActual, ejResuelto);
                if (!diagramaFallo && !cancelado) {
                    const btnCorregir = ejActual.querySelector('.btCorregir, #btCorregir');
                    if (btnCorregir) { btnCorregir.removeAttribute('disabled'); btnCorregir.disabled = false; btnCorregir.click(); await sleep(600); }
                    reemplazados++;
                }
            }
        }

        if (reemplazados === 0) showToast(omitidos > 0 ? `No inyectado: ${omitidos} omitidos según el filtro.` : 'No se pudo emparejar ningún ejercicio.', 'warning');
        resetearBtn();
    }

    btnGitHub.addEventListener('click', async () => {
        if (btnGitHub.disabled) return;
        const meta = obtenerMetadatosCapitulo();
        if (!meta) { showToast('No detectado.', 'error'); return; }
        btnGitHub.disabled = btnLocal.disabled = selectModo.disabled = true;
        btnGitHub.innerHTML = `<span style="font-size:10px; font-weight:bold;">...</span>`;
        btnGitHub.style.opacity = '0.7';
        try { const html = await descargarHTMLDesdeGitHub(meta); await ejecutarInyeccionConHTML(html); } 
        catch (err) { showToast(err.message, 'error'); resetearBtn(); }
    });

    btnLocal.addEventListener('click', () => { if (!btnLocal.disabled) inputFile.click(); });
    inputFile.addEventListener('change', () => {
        const file = inputFile.files[0]; if (!file) return;
        btnGitHub.disabled = btnLocal.disabled = selectModo.disabled = true; btnGitHub.innerHTML = `...`; btnGitHub.style.opacity = '0.7';
        const reader = new FileReader(); reader.onload = async (e) => { inputFile.value = ''; await ejecutarInyeccionConHTML(e.target.result); }; reader.readAsText(file);
    });
})();
