// ==UserScript==
// @name         Inyector Maestro V33.2 (Ghost Loop Text-Match + 4 Modos)
// @namespace    http://tampermonkey.net/
// @version      33.2
// @description  Descarga desde GitHub (mael-sysm/cap). Pestaña invisible. Resuelve el problema de las variables internas haciendo cientos de iteraciones invisibles en 0.1 segundos hasta que el texto coincide.
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
    // MÓDULO 1: AUTO-DESBLOQUEADOR Y LIMPIEZA
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
        window.savePage = function () { limpiarRastro(); return saveOriginal.apply(this, arguments); };
        window.savePage._envuelto = true;
    }

    function alHacerClic(evento) {
        const boton = evento.target.closest && evento.target.closest('button');
        if (!boton) return;
        const onclick = boton.getAttribute('onclick') || '';
        if (!boton.classList.contains('btGenerar') && !onclick.includes('generar') &&
            !boton.classList.contains('btRepetir') && !onclick.includes('repetir')) return;

        const ejercicio = boton.closest('.ejercicio');
        if (!ejercicio) return;
        clearTimeout(timers.get(ejercicio));
        timers.set(ejercicio, setTimeout(() => {
            timers.delete(ejercicio);
            const corregir = ejercicio.querySelector('#btCorregir, .btCorregir');
            if (corregir) { corregir.removeAttribute('disabled'); corregir.disabled = false; }
        }, ESPERA_MS));
    }
    document.addEventListener('click', alHacerClic, true);

    // =========================================================================
    // MÓDULO 2: DESCARGA GITHUB
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
        const candidatosDirectos = [`${baseRaw}/${num}.html`, `${baseRaw}/${meta.capitulo}.html`, `${baseRaw}/${num.padStart(2, '0')}.html`];

        for (const url of candidatosDirectos) {
            try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) return cacheHTMLGitHub = await r.text(); } catch (e) {}
        }

        const apiUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${meta.materia}?ref=${GITHUB_BRANCH}`;
        const respApi = await fetch(apiUrl, { cache: 'no-store' });
        if (!respApi.ok) throw new Error(`No se encontró la carpeta en GitHub.`);

        const archivos = await respApi.json();
        const limpiar = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        let archivoElegido = archivos.find(f => f.type === 'file' && (new RegExp(`^0*${num}\\.html?$`, 'i').test(f.name.trim()) || new RegExp(`cap[ií]tulo[\\s_-]*0*${num}(?!\\d).*\\.html?$`, 'i').test(limpiar(f.name))));
        if (!archivoElegido) throw new Error(`No hay archivo para el capítulo ${num}.`);

        const respHtml = await fetch(archivoElegido.download_url, { cache: 'no-store' });
        if (!respHtml.ok) throw new Error(`Error al descargar "${archivoElegido.name}".`);
        return cacheHTMLGitHub = await respHtml.text();
    }

    // =========================================================================
    // MÓDULO 3: HUELLA DACTILAR Y UTILIDADES DOM
    // =========================================================================
    function showToast(msg, type = 'info') {
        if (cancelado) return;
        const toast = document.createElement('div'); toast.className = 'tm-inyectado';
        const colors = { info: '#3b82f6', success: '#16a34a', error: '#ef4444', warning: '#f59e0b' };
        Object.assign(toast.style, { position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%) translateY(100px)', background: colors[type] || colors.info, color: 'white', padding: '12px 24px', fontFamily: 'system-ui', fontSize: '14px', fontWeight: '500', zIndex: '10000', opacity: '0', transition: 'all 0.3s' });
        toast.textContent = msg; document.body.appendChild(toast);
        requestAnimationFrame(() => { toast.style.transform = 'translateX(-50%) translateY(0)'; toast.style.opacity = '1'; });
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    async function esperarHasta(cond, max = 2500, paso = 40) {
        const fin = Date.now() + max;
        while (Date.now() < fin) { if (cancelado) return false; try { if (cond()) return true; } catch (e) {} await sleep(paso); }
        return false;
    }

    const SEL_CAMPOS = '.campo_literal, .campo_arrastrar, .campo_dato', SEL_TODO = SEL_CAMPOS + ', p.opcionMultiple';
    const norm = t => (t || '').replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();
    const esVisible = el => !!(el && (el.offsetParent || el.getClientRects().length));

    function obtenerNotaEjercicio(ej) { const inp = ej.querySelector('input.notas, input.itmostrar.notas'); return parseFloat(inp ? (inp.value || inp.getAttribute('value') || '0') : '0') || 0; }
    function textoInst(el) { const d = document.createElement('div'); d.innerHTML = el.innerHTML.replace(/<br\s*[\/]?>/gi, '\n').replace(/<\/p>|<\/div>/gi, '\n'); return d.textContent.replace(/\u200B/g, '').replace(/^\n+|\n+$/g, ''); }

    // NUEVO SISTEMA DE HUELLA DACTILAR: Capta las variables internas del texto del problema
    function firmaCampos(ej) {
        const partes = Array.from(ej.querySelectorAll(SEL_TODO))
            .map(el => el.closest('p, div.dato tr, li') || el.parentElement)
            .filter((v, i, a) => v && a.indexOf(v) === i)
            .map(n => {
                const c = n.cloneNode(true);
                c.querySelectorAll(SEL_CAMPOS).forEach(sp => {
                    const ops = (sp.getAttribute('data-opciones') || '').split('&@%').map(norm).sort().join('|');
                    sp.replaceWith('§' + (ops ? '{' + ops + '}' : ''));
                });
                return norm(c.textContent);
            });
        const en = ej.getAttribute('enunciado') || 'x';
        return en + '||' + partes.sort().join('||');
    }

    const conocimiento = new Map();
    try { JSON.parse(localStorage.getItem(KB_KEY) || '[]').forEach(([k, v]) => conocimiento.set(k, v)); } catch (e) {}
    const guardarKB = () => { if (!cancelado) try { localStorage.setItem(KB_KEY, JSON.stringify([...conocimiento])); } catch (e) {} };
    const textoOpcion = p => norm((p.querySelector('label') || {}).textContent);

    async function elegirOpcion(campo, respuesta) {
        const buscar = () => Array.from(document.body.querySelectorAll('div, li, span, a, p, td')).filter(el => el !== campo && !campo.contains(el) && !el.closest('.CodeMirror') && !el.closest('.tm-inyectado') && norm(el.textContent) === respuesta && esVisible(el) && !Array.from(el.children).some(h => norm(h.textContent) === respuesta));
        const antes = new Set(buscar()); campo.click();
        await esperarHasta(() => buscar().some(el => !antes.has(el)), 1500);
        const nuevas = buscar().filter(el => !antes.has(el));
        if (nuevas.length) { ['mousedown', 'mouseup', 'click'].forEach(t => nuevas[0].dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))); await esperarHasta(() => norm(campo.textContent) === respuesta, 800); }
        if (norm(campo.textContent) !== respuesta) { campo.textContent = respuesta; campo.dispatchEvent(new Event('input', { bubbles: true })); campo.dispatchEvent(new Event('change', { bubbles: true })); }
    }

    async function escribirCelda(liveCalc, indice, texto) {
        if (!texto || cancelado) return;
        let liveCM = liveCalc.querySelectorAll('.CodeMirror')[indice];
        if (!liveCM) { await esperarHasta(() => liveCalc.querySelectorAll('.CodeMirror')[indice], 2000); liveCM = liveCalc.querySelectorAll('.CodeMirror')[indice]; }
        if (liveCM && liveCM.CodeMirror) { liveCM.CodeMirror.setValue(texto); liveCM.CodeMirror.getInputField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true, bubbles: true })); await sleep(120); }
    }

    // =========================================================================
    // MÓDULO 4: DIAGRAMAS GOJS
    // =========================================================================
    function limpiarComodines(t) { return typeof t !== 'string' || !t.includes('_(') ? t : t.replace(/_\(([\s\S]*?)_\)/g, (m, i) => i.split('_|')[0].replace(/_/g, '')).replace(/[ \t]{2,}/g, ' ').trim(); }
    function extraerModeloGoJS(t) { if (!t) return null; const i = t.lastIndexOf('{"class":"go.GraphLinksModel"'); if (i === -1) return null; let p=0, e=false, s=false; for (let j=i; j<t.length; j++) { const c=t[j]; if(e) { s=(c==='\\' && !s); if(c==='"' && !s) e=false; continue; } if(c==='"') e=true; else if(c==='{') p++; else if(c==='}') { p--; if(p===0) { try{return JSON.parse(t.slice(i, j+1))} catch(err){return null;} } } } return null; }
    const esDiagSrc = c => /gojsGraph\s*\(/.test(c.textContent); const esDiagVivo = c => !!c.querySelector('canvas') || /gojsGraph\s*\(/.test(c.textContent);
    function diagDe(c) { const cv = c.querySelector('canvas'); if (!cv || !window.go || !window.go.Diagram) return null; for (let e = cv; e; e = e.parentElement) { const d = window.go.Diagram.fromDiv(e); if (d) return d; } return null; }
    function corrEn(c) { const n = c.cloneNode(true); n.querySelectorAll('.CodeMirror, .instruccion, textarea, canvas, svg').forEach(e => e.remove()); return /correcto/.test(norm(n.textContent).toLowerCase()) && !/incorrecto/.test(norm(n.textContent).toLowerCase()); }
    function sEntEn(e) { if (e) ['keydown', 'keyup'].forEach(t => e.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true, bubbles: true }))); }

    async function procesarDiagrama(liveCalc, srcCalc) {
        const modelo = extraerModeloGoJS(srcCalc.textContent) || extraerModeloGoJS(liveCalc.textContent);
        if (!modelo) return null; await esperarHasta(() => diagDe(liveCalc), 2500); const d = diagDe(liveCalc);
        if (d) {
            d.startTransaction('Iny');
            try {
                const env = [...d.model.linkDataArray]; if (d.model.removeLinkDataCollection) d.model.removeLinkDataCollection(env); else env.forEach(l => d.model.removeLinkData(l));
                (modelo.nodeDataArray || []).forEach(src => { const tx = limpiarComodines(src.text); const n = d.model.findNodeDataForKey(src.key); if (n) { if (src.text !== undefined) d.model.setDataProperty(n, 'text', tx); } else { const c = JSON.parse(JSON.stringify(src)); c.text = tx; d.model.addNodeData(c); } });
                (modelo.linkDataArray || []).forEach(l => { const c = JSON.parse(JSON.stringify(l)); if (typeof c.text === 'string') c.text = limpiarComodines(c.text); d.model.addLinkData(c); });
                d.commitTransaction('Iny'); await sleep(60); sEntEn(liveCalc.querySelector('canvas'));
            } catch (e) { d.rollbackTransaction(); }
        } else {
            const textos = Array.from(srcCalc.querySelectorAll('.instruccion')).map(textoInst).map(limpiarComodines);
            for (let k = 0; k < textos.length; k++) await escribirCelda(liveCalc, k, textos[k]);
        }
        if (!VERIFICAR_DIAGRAMA) return true;
        let ok = await esperarHasta(() => corrEn(liveCalc), 2500, 100);
        if (!ok && !cancelado) { sEntEn(liveCalc.querySelector('canvas')); ok = await esperarHasta(() => corrEn(liveCalc), 3000, 100); }
        return ok;
    }

    async function rellenarContenidoEjercicio(ejActual, ejResuelto) {
        const tieneCampos = ejActual.querySelector(SEL_TODO) !== null;
        const liveCalc = Array.from(ejActual.querySelectorAll('.calculadora')), srcCalc = Array.from(ejResuelto.querySelectorAll('.calculadora'));
        const srcDiag = srcCalc.filter(esDiagSrc), srcNoDiag = srcCalc.filter(c => !esDiagSrc(c)), liveNoDiag = liveCalc.filter(c => !esDiagVivo(c));

        const plan = new Map();
        if (liveNoDiag.length === srcNoDiag.length) liveNoDiag.forEach((c, j) => plan.set(c, Array.from(srcNoDiag[j].querySelectorAll('.instruccion')).map(textoInst)));
        else { const todas = srcNoDiag.flatMap(c => Array.from(c.querySelectorAll('.instruccion')).map(textoInst)).filter(t => t); const cupo = liveNoDiag.map(c => Math.max(1, Array.from(c.querySelectorAll('.CodeMirror')).filter(cm => cm.CodeMirror && cm.CodeMirror.getValue().trim() !== '').length)); liveNoDiag.forEach((c, j) => plan.set(c, j === liveNoDiag.length - 1 ? todas.splice(0) : todas.splice(0, cupo[j]))); }

        let fallod = false, idxD = 0;
        for (const lc of liveCalc) {
            if (cancelado) return { diagramaFallo: false };
            if (esDiagVivo(lc)) { if (srcDiag[idxD] && await procesarDiagrama(lc, srcDiag[idxD++]) === false) fallod = true; } 
            else { const txts = plan.get(lc) || []; for (let k = 0; k < txts.length; k++) await escribirCelda(lc, k, txts[k]); }
        }
        if (fallod) return { diagramaFallo: true };

        if (tieneCampos && !cancelado) {
            const sLit = ejResuelto.querySelectorAll('.campo_literal'), lLit = ejActual.querySelectorAll('.campo_literal');
            for (let k = 0; k < lLit.length; k++) { if (!sLit[k]) continue; lLit[k].textContent = norm(sLit[k].textContent); lLit[k].dispatchEvent(new Event('input', { bubbles: true })); lLit[k].dispatchEvent(new Event('change', { bubbles: true })); await sleep(20); }
            const sSel = Array.from(ejResuelto.querySelectorAll('.campo_arrastrar, .campo_dato')), lSel = Array.from(ejActual.querySelectorAll('.campo_arrastrar, .campo_dato'));
            const cFila = c => { const td = c.closest('tr') && c.closest('tr').firstElementChild; return td && !td.contains(c) ? norm(td.textContent) : null; };
            for (let k = 0; k < lSel.length; k++) { if (cancelado) return { diagramaFallo: false }; let o = cFila(lSel[k]) ? sSel.find(c => cFila(c) === cFila(lSel[k])) : null; if (!o) o = sSel[k]; if (o) await elegirOpcion(lSel[k], norm(o.textContent)); }
            ejActual.querySelectorAll('p.opcionMultiple').forEach(p => { const i = p.querySelector('input'); const q = conocimiento.get(textoOpcion(p)); if (i && q !== undefined && i.checked !== q) i.click(); });
        }

        const sInp = ejResuelto.querySelectorAll('input[type="text"]:not(.notas):not(.ittiempo)');
        ejActual.querySelectorAll('input[type="text"]:not(.notas):not(.ittiempo)').forEach((i, idx) => { if (sInp[idx]) { i.value = sInp[idx].value || sInp[idx].getAttribute('value') || ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); } });
        await sleep(100); return { diagramaFallo: false };
    }

    // =========================================================================
    // MÓDULO 5: INTERFAZ GRÁFICA INVISIBLE
    // =========================================================================
    const metaActual = obtenerMetadatosCapitulo();
    const etiquetaCap = metaActual ? `${metaActual.materia.toUpperCase()} · Cap ${metaActual.num}` : 'V33.2';
    const contenedorRaiz = document.createElement('div'); contenedorRaiz.className = 'tm-inyectado';
    Object.assign(contenedorRaiz.style, { position: 'fixed', bottom: '28px', right: '0', zIndex: '9999', display: 'flex', alignItems: 'center', fontFamily: 'system-ui, sans-serif' });
    const panelMenu = document.createElement('div'); Object.assign(panelMenu.style, { display: 'none', flexDirection: 'column', gap: '8px', background: 'rgba(15, 23, 42, 0.95)', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.15)', borderRight: 'none' });
    const seccionInfo = document.createElement('div'); seccionInfo.textContent = etiquetaCap; Object.assign(seccionInfo.style, { background: '#1e293b', color: '#38bdf8', padding: '5px 8px', fontSize: '11px', fontWeight: '700', textAlign: 'center', border: '1px solid #334155' });
    const filaControles = document.createElement('div'); Object.assign(filaControles.style, { display: 'flex', alignItems: 'center', gap: '6px' });
    const selectModo = document.createElement('select'); Object.assign(selectModo.style, { padding: '6px 12px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #475569', borderRadius: '999px', fontSize: '11px', outline: 'none' });
    ['Solo no iniciados', 'Solo iniciados (<100)', 'Sin corregir (en curso)', 'Todos'].forEach((t, i) => { const o = document.createElement('option'); o.value = ['no_iniciados', 'iniciados', 'sin_corregir', 'todos'][i]; o.textContent = t; selectModo.appendChild(o); });
    const btnGitHub = document.createElement('button'); const iconoDescarga = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`; btnGitHub.innerHTML = iconoDescarga; Object.assign(btnGitHub.style, { width: '32px', height: '32px', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' });
    const btnLocal = document.createElement('button'); btnLocal.textContent = 'Local'; Object.assign(btnLocal.style, { padding: '6px 12px', background: '#334155', color: 'white', border: 'none', borderRadius: '999px', cursor: 'pointer', fontSize: '11px', fontWeight: '600' });
    const btnCerrar = document.createElement('button'); btnCerrar.textContent = '✕'; Object.assign(btnCerrar.style, { width: '28px', height: '28px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }); btnCerrar.addEventListener('click', limpiarRastro);
    const btnPestana = document.createElement('button'); Object.assign(btnPestana.style, { width: '16px', height: '36px', background: 'transparent', color: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', opacity: '0' });
    let menuAbierto = false; btnPestana.addEventListener('click', () => { menuAbierto = !menuAbierto; panelMenu.style.display = menuAbierto ? 'flex' : 'none'; });
    filaControles.append(selectModo, btnGitHub, btnLocal, btnCerrar); panelMenu.append(seccionInfo, filaControles); contenedorRaiz.append(panelMenu, btnPestana); document.body.appendChild(contenedorRaiz);
    const inputFile = document.createElement('input'); inputFile.type = 'file'; inputFile.accept = '.html,.htm'; inputFile.style.display = 'none'; document.body.appendChild(inputFile);
    function resetearBtn() { desactivarEscudoFoco(); if (cancelado) return; btnGitHub.disabled = btnLocal.disabled = selectModo.disabled = false; btnGitHub.innerHTML = iconoDescarga; btnGitHub.style.opacity = '1'; }

    // =========================================================================
    // MÓDULO 6: EL BUCLE FANTASMA SÍNCRONO (GHOST LOOP)
    // =========================================================================
    async function ejecutarInyeccionConHTML(htmlTexto) {
        activarEscudoFoco();
        const modo = selectModo.value;

        let doc;
        try { doc = new DOMParser().parseFromString(htmlTexto, 'text/html'); } catch (e) { showToast('Error: HTML inválido.', 'error'); resetearBtn(); return; }
        doc.querySelectorAll('p.opcionMultiple').forEach(p => { const inp = p.querySelector('input'); if (inp) conocimiento.set(textoOpcion(p), inp.checked || inp.hasAttribute('checked')); });
        guardarKB();

        const liveEjercicios = Array.from(document.querySelectorAll('div.ejercicio[id]'));
        let reemplazados = 0, omitidos = 0;

        for (let i = 0; i < liveEjercicios.length; i++) {
            if (cancelado) return;
            const ejActual = liveEjercicios[i];
            const id = ejActual.id;
            if (!id) continue;

            const btnGen = ejActual.querySelector('.btGenerar');
            const btnRep = ejActual.querySelector('.btRepetir');
            const btnCor = ejActual.querySelector('#btCorregir, .btCorregir');
            const tieneRepetir = !!(btnRep && esVisible(btnRep)), tieneGenerar = !!(btnGen && esVisible(btnGen));

            if (modo === 'sin_corregir') {
                if (!esVisible(btnCor) || tieneGenerar || tieneRepetir) continue;
            } else {
                const notaActual = obtenerNotaEjercicio(ejActual);
                if (modo === 'no_iniciados' && (tieneRepetir || !tieneGenerar)) { omitidos++; continue; }
                if (modo === 'iniciados' && (!tieneRepetir || notaActual >= 100)) { omitidos++; continue; }
                if (modo === 'todos' && !tieneGenerar && !tieneRepetir) { omitidos++; continue; }
            }

            const resueltos = Array.from(doc.querySelectorAll(`div.ejercicio[id="${id}"]`));
            if (resueltos.length === 0) continue; 
            
            btnGitHub.innerHTML = `<span style="font-size:10px; font-weight:bold;">${i + 1}</span>`;

            // Verificamos si el ejercicio actual ya coincide textualmente
            let firmaAct = firmaCampos(ejActual);
            let ejResueltoFinal = resueltos.find(r => firmaCampos(r) === firmaAct);

            // Si no coincide, iniciamos el BUCLE FANTASMA
            if (!ejResueltoFinal) {
                if (esVisible(btnCor) && !tieneGenerar && !tieneRepetir) {
                    btnCor.removeAttribute('disabled'); btnCor.disabled = false; btnCor.click();
                    await esperarHasta(() => esVisible(ejActual.querySelector('.btRepetir')), 2000);
                }

                const botonAccion = esVisible(ejActual.querySelector('.btGenerar')) ? ejActual.querySelector('.btGenerar') : ejActual.querySelector('.btRepetir');
                
                if (botonAccion) {
                    const originalRandom = Math.random;
                    const maxGhostAttempts = 200; // 200 clics ultra rápidos en memoria
                    let matchFound = false;

                    for (let att = 0; att < maxGhostAttempts; att++) {
                        // Limpiar el seguro de la plataforma para que nos deje hacer múltiples clics
                        if (typeof window.Ejercicio !== 'undefined' && window.Ejercicio.intervalId) {
                            clearInterval(window.Ejercicio.intervalId);
                            window.Ejercicio.intervalId = null;
                        }

                        // Alimentamos a la plataforma con una semilla matemática diferente cada milisegundo
                        Math.random = function() { return (att * 0.137 + originalRandom() * 0.05) % 1; };
                        
                        botonAccion.click(); // Clic síncrono (el navegador no dibuja nada aún)

                        // Leemos inmediatamente la firma de los números del texto
                        let currentFirma = firmaCampos(ejActual);
                        ejResueltoFinal = resueltos.find(r => firmaCampos(r) === currentFirma);

                        if (ejResueltoFinal) {
                            matchFound = true;
                            break; // ¡Coincide con el texto exacto! Rompemos el bucle fantasma.
                        }
                    }
                    
                    Math.random = originalRandom; // Restauramos
                    if (matchFound) await sleep(100); // Pequeña pausa para que el navegador dibuje el resultado final en tu pantalla
                }
            }

            // 3. INYECTAR LA RESPUESTA
            if (ejResueltoFinal) {
                const { diagramaFallo } = await rellenarContenidoEjercicio(ejActual, ejResueltoFinal);
                if (!diagramaFallo && !cancelado) {
                    const nuevoCor = ejActual.querySelector('#btCorregir, .btCorregir');
                    if (nuevoCor) { nuevoCor.removeAttribute('disabled'); nuevoCor.disabled = false; nuevoCor.click(); await sleep(600); }
                    reemplazados++;
                }
            }
        }

        if (reemplazados === 0 && modo !== 'sin_corregir') {
            const motivo = modo === 'no_iniciados' ? 'ya estaban iniciados' : (modo === 'iniciados' ? 'ya tienen nota 100' : 'sin botones activos');
            showToast(omitidos > 0 ? `Omitidos: ${omitidos} (${motivo}).` : 'No se emparejó ningún ejercicio. (Ninguno coincidió con los números).', 'warning');
        }
        resetearBtn();
    }

    btnGitHub.addEventListener('click', async () => {
        if (btnGitHub.disabled) return;
        const meta = obtenerMetadatosCapitulo(); if (!meta) { showToast('Materia no detectada.', 'error'); return; }
        btnGitHub.disabled = btnLocal.disabled = selectModo.disabled = true; btnGitHub.innerHTML = `...`; btnGitHub.style.opacity = '0.7';
        try { const html = await descargarHTMLDesdeGitHub(meta); await ejecutarInyeccionConHTML(html); } catch (err) { showToast(err.message, 'error'); resetearBtn(); }
    });

    btnLocal.addEventListener('click', () => { if (!btnLocal.disabled) inputFile.click(); });
    inputFile.addEventListener('change', () => {
        const file = inputFile.files[0]; if (!file) return;
        btnGitHub.disabled = btnLocal.disabled = selectModo.disabled = true; btnGitHub.innerHTML = `...`; btnGitHub.style.opacity = '0.7';
        const reader = new FileReader(); reader.onload = async (e) => { inputFile.value = ''; await ejecutarInyeccionConHTML(e.target.result); }; reader.readAsText(file);
    });
})();
