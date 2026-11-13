// ==UserScript==
// @name         Inyector Maestro V34.2 (Correccion GitHub + Estado)
// @namespace    http://tampermonkey.net/
// @version      34.2
// @description  Descarga GitHub/Local. Inyeccion exacta, Math.random y manejo de errores detallado.
// @author       mercz d
// @match        https://cursosabiertos.usfx.bo/materias/*/capitulos/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    if (!document.querySelector('.ejercicio')) return;

    // =========================================================================
    // CONFIGURACION DEL REPOSITORIO GITHUB
    // =========================================================================
    const GITHUB_USER   = 'mael-sysm'; // OJO: Cambia a 'mrc-dza' si es necesario
    const GITHUB_REPO   = 'cap';
    const GITHUB_BRANCH = 'main';

    const VERIFICAR_DIAGRAMA = true;
    let cancelado = false;
    let cacheHTMLGitHub = null;

    // =========================================================================
    // MODULO 0: INTERCEPTOR DE VARIANTES (HACK MATH.RANDOM)
    // =========================================================================
    window.__tm_variante_deseada = null; 

    const hookVariantesId = setInterval(() => {
        if (typeof window.Ejercicio !== 'undefined' && typeof window.Capitulo !== 'undefined' && !window.Ejercicio.prototype._tm_hooked) {
            const generarOriginal = window.Ejercicio.prototype.generarEjercicio;
            window.Ejercicio.prototype.generarEjercicio = function() {
                
                if (window.__tm_variante_deseada !== null) {
                    if (window.Capitulo.reg && window.Capitulo.reg[window.Ejercicio.neg]) {
                        window.Capitulo.reg[window.Ejercicio.neg][0] = 0; 
                    }
                    
                    let totalVariantes = this.enunciados ? this.enunciados.length : 1;
                    let varSegura = window.__tm_variante_deseada;
                    
                    if (varSegura >= totalVariantes) {
                        varSegura = totalVariantes > 0 ? totalVariantes - 1 : 0;
                    }

                    const randomOrig = Math.random;
                    Math.random = function() { 
                        return (varSegura + 0.1) / totalVariantes; 
                    };
                    
                    const resultado = generarOriginal.apply(this, arguments);
                    Math.random = randomOrig;
                    
                    console.log(`[INYECTOR] Variante forzada con exito al enunciado ${varSegura} (de ${totalVariantes}).`);
                    return resultado;
                } else {
                    return generarOriginal.apply(this, arguments);
                }
            };
            window.Ejercicio.prototype._tm_hooked = true;
            clearInterval(hookVariantesId);
            console.log("[INYECTOR] Interceptor de generacion activo.");
        }
    }, 100);

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
    // MODULO 1: LIMPIEZA Y CONTROL DE EVENTOS
    // =========================================================================
    const ESPERA_MS = 300;
    const timers = new Map();

    function limpiarRastro() {
        cancelado = true;
        desactivarEscudoFoco();
        document.removeEventListener('click', alHacerClic, true);
        document.removeEventListener('click', interceptarGuardar, true);
        timers.forEach(id => clearTimeout(id));
        timers.clear();
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
    // MODULO 2: DESCARGA GITHUB Y METADATOS (ERRORES DETALLADOS)
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
        const numPad = num.padStart(2, '0');

        const candidatosDirectos = [
            `${baseRaw}/${num}.html`, 
            `${baseRaw}/${meta.capitulo}.html`, 
            `${baseRaw}/${numPad}.html`,
            `${baseRaw}/Capitulo%20${num}.html`
        ];

        // Intento directo para no gastar cuota de API
        for (const url of candidatosDirectos) {
            try {
                const r = await fetch(url, { cache: 'no-store' });
                if (r.ok) return (cacheHTMLGitHub = await r.text());
            } catch (e) {}
        }

        // Si falla el directo, usamos la API para explorar los archivos
        const apiUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${meta.materia}?ref=${GITHUB_BRANCH}`;
        const respApi = await fetch(apiUrl, { cache: 'no-store' });
        
        if (!respApi.ok) {
            if (respApi.status === 404) throw new Error(`Carpeta "${meta.materia}" no existe en GitHub.`);
            if (respApi.status === 403 || respApi.status === 429) throw new Error(`Limite de API GitHub excedido (Error 403). Intenta usar Local.`);
            throw new Error(`Error API GitHub: ${respApi.status}`);
        }

        const archivos = await respApi.json();
        if (!Array.isArray(archivos)) throw new Error('Respuesta inesperada de GitHub.');

        const limpiar = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const coincidencias = [
            f => new RegExp(`^0*${num}\\.html?$`, 'i').test(f.name.trim()),
            f => new RegExp(`cap[ií]tulo[\\s_-]*0*${num}(?!\\d).*\\.html?$`, 'i').test(limpiar(f.name)),
            f => new RegExp(`(?:^|[^\\d])0*${num}\\.html?$`, 'i').test(f.name.trim())
        ];

        let archivoElegido = null;
        for (const regla of coincidencias) {
            archivoElegido = archivos.find(f => f.type === 'file' && regla(f));
            if (archivoElegido) break;
        }

        if (!archivoElegido) throw new Error(`El archivo HTML para el capitulo ${num} no se encontro en "${meta.materia}".`);

        const urlFinal = archivoElegido.download_url || `${baseRaw}/${encodeURIComponent(archivoElegido.name)}`;
        const respHtml = await fetch(urlFinal, { cache: 'no-store' });
        if (!respHtml.ok) throw new Error(`Fallo al descargar el archivo final (Error ${respHtml.status}).`);

        return (cacheHTMLGitHub = await respHtml.text());
    }

    // =========================================================================
    // MODULO 3: UTILIDADES
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
            fontFamily: 'system-ui, sans-serif', fontSize: '13px', fontWeight: '500',
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

    function extraerNumCapTitulo(titulo) {
        const m = (titulo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/capitulo\s*(\d+)/i);
        return m ? m[1] : null;
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    async function esperarHasta(cond, max = 2500, paso = 40) {
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

    function textoInst(el) {
        const d = document.createElement('div');
        d.innerHTML = el.innerHTML.replace(/<br\s*[\/]?>/gi, '\n').replace(/<\/p>|<\/div>/gi, '\n');
        return d.textContent.replace(/\u200B/g, '').replace(/^\n+|\n+$/g, '');
    }

    async function elegirOpcion(campo, respuesta) {
        const SEL_POPUP = 'div, li, span, a, p, td';
        const buscar = () => Array.from(document.body.querySelectorAll(SEL_POPUP)).filter(el =>
            el !== campo && !campo.contains(el) && !el.closest('.CodeMirror') && !el.closest('.tm-inyectado') &&
            norm(el.textContent) === respuesta && esVisible(el) &&
            !Array.from(el.children).some(h => norm(h.textContent) === respuesta));

        const antes = new Set(buscar());
        campo.click();
        await esperarHasta(() => buscar().some(el => !antes.has(el)), 1500);

        const nuevas = buscar().filter(el => !antes.has(el));
        if (nuevas.length) {
            const op = nuevas[0];
            ['mousedown', 'mouseup', 'click'].forEach(t => op.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true })));
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
        if (!liveCM) {
            await esperarHasta(() => liveCalc.querySelectorAll('.CodeMirror')[indice], 2000);
            liveCM = liveCalc.querySelectorAll('.CodeMirror')[indice];
        }
        if (liveCM && liveCM.CodeMirror) {
            const cm = liveCM.CodeMirror;
            cm.setValue(texto);
            cm.getInputField().dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true, bubbles: true, cancelable: true
            }));
            await sleep(120);
        }
    }

    // =========================================================================
    // MODULO 4: DIAGRAMAS GOJS
    // =========================================================================
    function limpiarComodines(t) {
        if (typeof t !== 'string' || !t.includes('_(')) return t;
        return t.replace(/_\(([\s\S]*?)_\)/g, (m, inner) => inner.split('_|')[0].replace(/_/g, '')).replace(/[ \t]{2,}/g, ' ').trim();
    }

    function extraerModeloGoJS(texto) {
        if (!texto) return null;
        const ini = texto.lastIndexOf('{"class":"go.GraphLinksModel"');
        if (ini === -1) return null;
        let prof = 0, enCadena = false, escape = false;
        for (let i = ini; i < texto.length; i++) {
            const ch = texto[i];
            if (enCadena) {
                if (escape) escape = false; else if (ch === '\\') escape = true; else if (ch === '"') enCadena = false;
                continue;
            }
            if (ch === '"') { enCadena = true; continue; }
            if (ch === '{') prof++;
            else if (ch === '}') {
                prof--;
                if (prof === 0) {
                    try { return JSON.parse(texto.slice(ini, i + 1)); } catch (e) { return null; }
                }
            }
        }
        return null;
    }

    const esDiagramaSrc  = c => /gojsGraph\s*\(/.test(c.textContent);
    const esDiagramaVivo = c => !!c.querySelector('canvas') || /gojsGraph\s*\(/.test(c.textContent);

    function diagramaDe(calc) {
        const cv = calc.querySelector('canvas');
        if (!cv || !window.go || !window.go.Diagram) return null;
        for (let el = cv; el; el = el.parentElement) {
            const d = window.go.Diagram.fromDiv(el);
            if (d) return d;
        }
        return null;
    }

    function correctoEn(calc) {
        const c = calc.cloneNode(true);
        c.querySelectorAll('.CodeMirror, .instruccion, textarea, canvas, svg').forEach(e => e.remove());
        const t = norm(c.textContent).toLowerCase();
        return /correcto/.test(t) && !/incorrecto/.test(t);
    }

    function shiftEnterEn(el) {
        if (!el) return;
        ['keydown', 'keyup'].forEach(tipo =>
            el.dispatchEvent(new KeyboardEvent(tipo, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true, bubbles: true, cancelable: true })));
    }

    function inyectarModelo(d, modelo) {
        const m = d.model;
        d.startTransaction('InyeccionModelo');
        try {
            const enlacesViejos = [...m.linkDataArray];
            if (m.removeLinkDataCollection) m.removeLinkDataCollection(enlacesViejos); else enlacesViejos.forEach(l => m.removeLinkData(l));

            (modelo.nodeDataArray || []).forEach(src => {
                const texto = limpiarComodines(src.text);
                const nodo = m.findNodeDataForKey(src.key);
                if (nodo) { if (src.text !== undefined) m.setDataProperty(nodo, 'text', texto); }
                else { const copia = JSON.parse(JSON.stringify(src)); copia.text = texto; m.addNodeData(copia); }
            });
            (modelo.linkDataArray || []).forEach(l => {
                const copia = JSON.parse(JSON.stringify(l));
                if (typeof copia.text === 'string') copia.text = limpiarComodines(copia.text); m.addLinkData(copia);
            });
            d.commitTransaction('InyeccionModelo');
            return true;
        } catch (e) {
            try { d.rollbackTransaction(); } catch (e2) {}
            return false;
        }
    }

    async function procesarDiagrama(liveCalc, srcCalc) {
        const modelo = extraerModeloGoJS(srcCalc.textContent) || extraerModeloGoJS(liveCalc.textContent);
        if (!modelo) return null;

        await esperarHasta(() => diagramaDe(liveCalc), 2500);
        const d = diagramaDe(liveCalc);

        if (d && inyectarModelo(d, modelo)) {
            await sleep(60);
            shiftEnterEn(liveCalc.querySelector('canvas'));
        } else {
            const textos = Array.from(srcCalc.querySelectorAll('.instruccion')).map(textoInst).map(limpiarComodines);
            for (let k = 0; k < textos.length; k++) await escribirCelda(liveCalc, k, textos[k]);
        }

        if (!VERIFICAR_DIAGRAMA) return true;

        let ok = await esperarHasta(() => correctoEn(liveCalc), 2500, 100);
        if (!ok && !cancelado) {
            const cv = liveCalc.querySelector('canvas');
            shiftEnterEn(cv);
            if (cv && cv.parentElement) shiftEnterEn(cv.parentElement);
            ok = await esperarHasta(() => correctoEn(liveCalc), 3000, 100);
        }
        return ok;
    }

    // =========================================================================
    // FUNCION UNIFICADA DE RELLENO EXACTO
    // =========================================================================
    async function rellenarContenidoEjercicio(ejActual, ejResuelto) {
        const tieneCampos = ejActual.querySelector(SEL_TODO) !== null;

        // A) CALCULADORAS
        const liveCalculadoras = Array.from(ejActual.querySelectorAll('.calculadora'));
        const sourceCalculadoras = Array.from(ejResuelto.querySelectorAll('.calculadora'));

        const srcDiag    = sourceCalculadoras.filter(esDiagramaSrc);
        const srcNoDiag  = sourceCalculadoras.filter(c => !esDiagramaSrc(c));
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
                const srcCalc = srcDiag[idxDiag++];
                if (!srcCalc) continue;
                const res = await procesarDiagrama(liveCalc, srcCalc);
                if (res === false) diagramaFallo = true;
            } else {
                const textos = planPorCalc.get(liveCalc) || [];
                for (let k = 0; k < textos.length; k++) {
                    await escribirCelda(liveCalc, k, textos[k]);
                }
            }
        }

        if (diagramaFallo) return { diagramaFallo: true };

        // B) CAMPOS LITERALES Y SELECCION
        if (tieneCampos && !cancelado) {
            const srcLit = ejResuelto.querySelectorAll('.campo_literal');
            const liveLit = ejActual.querySelectorAll('.campo_literal');
            for (let k = 0; k < liveLit.length; k++) {
                if (!srcLit[k] || cancelado) continue;
                const campo = liveLit[k];
                campo.textContent = norm(srcLit[k].textContent);
                campo.dispatchEvent(new Event('input', { bubbles: true }));
                campo.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                campo.dispatchEvent(new Event('change', { bubbles: true }));
                await sleep(20);
            }

            const SEL_SEL = '.campo_arrastrar, .campo_dato';
            const srcSel = Array.from(ejResuelto.querySelectorAll(SEL_SEL));
            const liveSel = Array.from(ejActual.querySelectorAll(SEL_SEL));
            const claveFila = c => {
                const td = c.closest('tr') && c.closest('tr').firstElementChild;
                return td && !td.contains(c) ? norm(td.textContent) : null;
            };
            for (let k = 0; k < liveSel.length; k++) {
                if (cancelado) return { diagramaFallo: false };
                const clave = claveFila(liveSel[k]);
                let origen = clave ? srcSel.find(c => claveFila(c) === clave) : null;
                if (!origen) origen = srcSel[k];
                if (!origen) continue;
                await elegirOpcion(liveSel[k], norm(origen.textContent));
            }

            // Opciones Multiples
            const srcOpciones = Array.from(ejResuelto.querySelectorAll('p.opcionMultiple'));
            ejActual.querySelectorAll('p.opcionMultiple').forEach((p, index) => {
                const inp = p.querySelector('input');
                const srcP = srcOpciones[index];
                if (inp && srcP) {
                    const srcInp = srcP.querySelector('input');
                    const quiere = srcInp && (srcInp.hasAttribute('checked') || srcInp.checked);
                    if (inp.checked !== quiere) inp.click();
                }
            });
        }

        // C) INPUTS DE TEXTO REGULARES
        const sourceInputs = ejResuelto.querySelectorAll('input[type="text"]:not(.notas):not(.ittiempo)');
        const liveInputs = ejActual.querySelectorAll('input[type="text"]:not(.notas):not(.ittiempo)');
        liveInputs.forEach((input, index) => {
            if (sourceInputs[index]) {
                input.value = sourceInputs[index].value || sourceInputs[index].getAttribute('value') || '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        await sleep(100);
        return { diagramaFallo: false };
    }

    // =========================================================================
    // MODULO 6: ORQUESTADOR PRINCIPAL
    // =========================================================================
    async function ejecutarInyeccionConHTML(htmlTexto) {
        activarEscudoFoco();
        const modo = selectModo.value;
        let doc;
        
        try { doc = new DOMParser().parseFromString(htmlTexto, 'text/html'); } 
        catch (err) { showToast('Error: HTML invalido.', 'error'); resetearBtn(); return; }

        const capDoc = extraerNumCapTitulo(doc.title);
        const capPag = extraerNumCapTitulo(document.title) || (metaActual && metaActual.num);
        if (capDoc && capPag && capDoc !== String(capPag)) {
            showToast(`Error: Archivo de cap ${capDoc}, pero estas en cap ${capPag}.`, 'error');
            resetearBtn(); return;
        }

        const liveEjercicios = Array.from(document.querySelectorAll('div.ejercicio[id]'));
        let reemplazados = 0;
        let omitidos = 0;

        for (let i = 0; i < liveEjercicios.length; i++) {
            if (cancelado) return;

            const ejActual = liveEjercicios[i];
            const id = ejActual.id;
            if (!id) continue;

            const btnGen = ejActual.querySelector('.btGenerar');
            const btnRep = ejActual.querySelector('.btRepetir');
            const tieneRepetirActivo = !!(btnRep && esVisible(btnRep));
            const tieneGenerarActivo = !!(btnGen && esVisible(btnGen));
            const notaActual = obtenerNotaEjercicio(ejActual);

            // Filtros de modo
            if (modo === 'sin_corregir') {
                const btnCor = ejActual.querySelector('#btCorregir, .btCorregir');
                const corVis = !!(btnCor && esVisible(btnCor));
                if (!corVis || tieneGenerarActivo || tieneRepetirActivo) continue;
            } else if (modo === 'no_iniciados') {
                if (tieneRepetirActivo || !tieneGenerarActivo) { omitidos++; continue; }
            } else if (modo === 'iniciados') {
                if (!tieneRepetirActivo || notaActual >= 100) { omitidos++; continue; }
            } else { 
                if (!tieneGenerarActivo && !tieneRepetirActivo) { omitidos++; continue; }
            }

            btnGitHub.innerHTML = `<span style="font-size:10px; font-weight:bold;">${i + 1}</span>`;

            // 1. Verificar si existe la resolucion
            let ejResuelto = doc.querySelector(`div.ejercicio[id="${id}"]`);
            if (!ejResuelto) {
                console.warn(`[INYECTOR] Ejercicio ${id} no encontrado en el archivo.`);
                omitidos++;
                continue;
            }

            // 2. Extraer parametros de las variantes
            let varianteDeseada = parseInt(ejResuelto.getAttribute('enunciado') || '0', 10);
            let numEnunciadoActual = parseInt(ejActual.getAttribute('enunciado') || '-1', 10);
            
            // Evaluacion de estado actual
            const btnCorregir = ejActual.querySelector('.btCorregir, #btCorregir');
            const estaCorriendo = !!(btnCorregir && esVisible(btnCorregir) && !tieneGenerarActivo && !tieneRepetirActivo);
            let necesitaGenerar = false;

            // 3. Maquina de estados
            if (estaCorriendo) {
                if (numEnunciadoActual !== varianteDeseada) {
                    // Quemamos el intento temporalmente para activar el Repetir
                    btnCorregir.removeAttribute('disabled');
                    btnCorregir.disabled = false;
                    btnCorregir.click();
                    await esperarHasta(() => {
                        const r = ejActual.querySelector('.btRepetir');
                        return r && esVisible(r);
                    }, 2500);
                    necesitaGenerar = true; 
                }
            } else {
                necesitaGenerar = true;
            }

            // 4. Forzar Variante
            if (necesitaGenerar) {
                window.__tm_variante_deseada = varianteDeseada;

                const btnGenRef = ejActual.querySelector('.btGenerar');
                const btnRepRef = ejActual.querySelector('.btRepetir');
                const botonAccion = (btnGenRef && esVisible(btnGenRef)) ? btnGenRef : (btnRepRef && esVisible(btnRepRef) ? btnRepRef : null);

                if (botonAccion) {
                    const antesHTML = ejActual.innerHTML;
                    botonAccion.click();
                    await esperarHasta(() => ejActual.innerHTML !== antesHTML, 3000);
                    await sleep(150);
                }

                window.__tm_variante_deseada = null; // Apagar interceptor
            }

            if (cancelado) return;

            // 5. Inyectar
            const { diagramaFallo } = await rellenarContenidoEjercicio(ejActual, ejResuelto);

            // 6. Corregir y terminar
            const btnCorregirFinal = ejActual.querySelector('.btCorregir, #btCorregir');
            if (btnCorregirFinal && !cancelado && !diagramaFallo) {
                btnCorregirFinal.removeAttribute('disabled');
                btnCorregirFinal.disabled = false;
                btnCorregirFinal.click();
                await sleep(700);
            }

            reemplazados++;
        }

        if (reemplazados === 0 && omitidos > 0) {
            showToast(`No se inyecto nada: ${omitidos} omitidos por el filtro.`, 'info');
            resetearBtn(); return;
        }
        if (reemplazados === 0) {
            showToast('No se encontro coincidencia con el archivo.', 'warning');
            resetearBtn(); return;
        }
        resetearBtn();
    }

    // =========================================================================
    // INTERFAZ DE USUARIO (GUI)
    // =========================================================================
    const metaActual = obtenerMetadatosCapitulo();
    const etiquetaCap = metaActual ? `${metaActual.materia.toUpperCase()} Cap ${metaActual.num}` : 'V34.2';

    const contenedorRaiz = document.createElement('div');
    contenedorRaiz.className = 'tm-inyectado';
    Object.assign(contenedorRaiz.style, {
        position: 'fixed', bottom: '28px', right: '0', zIndex: '9999', display: 'flex', alignItems: 'center', fontFamily: 'system-ui, sans-serif'
    });

    const panelMenu = document.createElement('div');
    Object.assign(panelMenu.style, {
        display: 'none', flexDirection: 'column', gap: '8px', background: 'rgba(15, 23, 42, 0.95)',
        padding: '10px 12px', border: '1px solid rgba(255,255,255,0.15)', borderRight: 'none'
    });

    const seccionInfo = document.createElement('div');
    seccionInfo.textContent = etiquetaCap;
    Object.assign(seccionInfo.style, { background: '#1e293b', color: '#38bdf8', padding: '5px 8px', fontSize: '11px', fontWeight: '700', textAlign: 'center', border: '1px solid #334155' });

    const filaControles = document.createElement('div');
    Object.assign(filaControles.style, { display: 'flex', alignItems: 'center', gap: '6px' });

    const selectModo = document.createElement('select');
    Object.assign(selectModo.style, { padding: '6px 12px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #475569', borderRadius: '999px', fontSize: '11px', outline: 'none' });
    
    ['no_iniciados', 'iniciados', 'sin_corregir', 'todos'].forEach((v, i) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = ['Solo no iniciados', 'Solo iniciados (<100)', 'Sin corregir (en curso)', 'Todos'][i];
        selectModo.appendChild(o);
    });

    const btnGitHub = document.createElement('button');
    const iconoDescarga = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
    btnGitHub.innerHTML = iconoDescarga;
    Object.assign(btnGitHub.style, { width: '32px', height: '32px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' });

    const btnLocal = document.createElement('button');
    btnLocal.textContent = 'Local';
    Object.assign(btnLocal.style, { padding: '6px 12px', background: '#334155', color: 'white', border: 'none', borderRadius: '999px', cursor: 'pointer', fontSize: '11px', fontWeight: '600' });

    const btnCerrar = document.createElement('button');
    btnCerrar.textContent = 'X';
    Object.assign(btnCerrar.style, { width: '28px', height: '28px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' });
    btnCerrar.addEventListener('click', limpiarRastro);

    const btnPestana = document.createElement('button');
    Object.assign(btnPestana.style, { width: '16px', height: '36px', background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', opacity: '0' });
    let menuAbierto = false;
    btnPestana.addEventListener('click', () => { menuAbierto = !menuAbierto; panelMenu.style.display = menuAbierto ? 'flex' : 'none'; });

    filaControles.append(selectModo, btnGitHub, btnLocal, btnCerrar);
    panelMenu.append(seccionInfo, filaControles);
    contenedorRaiz.append(panelMenu, btnPestana);
    document.body.appendChild(contenedorRaiz);

    const inputFile = document.createElement('input');
    inputFile.className = 'tm-inyectado'; inputFile.type = 'file'; inputFile.accept = '.html,.htm'; inputFile.style.display = 'none';
    document.body.appendChild(inputFile);

    function resetearBtn() {
        desactivarEscudoFoco();
        if (cancelado) return;
        btnGitHub.disabled = false; btnLocal.disabled = false; selectModo.disabled = false;
        btnGitHub.innerHTML = iconoDescarga; btnGitHub.style.opacity = '1';
    }

    btnGitHub.addEventListener('click', async () => {
        if (btnGitHub.disabled) return;
        const meta = obtenerMetadatosCapitulo();
        if (!meta) { showToast('Error: Metadatos de pagina no detectados.', 'error'); return; }

        btnGitHub.disabled = true; btnLocal.disabled = true; selectModo.disabled = true;
        btnGitHub.innerHTML = `<span style="font-size:10px; font-weight:bold;">...</span>`;
        btnGitHub.style.opacity = '0.7';

        try {
            const html = await descargarHTMLDesdeGitHub(meta);
            await ejecutarInyeccionConHTML(html);
        } catch (err) {
            // CORRECCION AQUI: Ahora muestra el error real (404, 403, etc)
            showToast(err.message || 'Fallo al descargar archivo de GitHub.', 'error');
            console.error("[INYECTOR ERROR GITHUB]:", err);
            resetearBtn();
        }
    });

    btnLocal.addEventListener('click', () => { if (!btnLocal.disabled) inputFile.click(); });
    inputFile.addEventListener('change', () => {
        const file = inputFile.files[0];
        if (!file) return;
        btnGitHub.disabled = true; btnLocal.disabled = true; selectModo.disabled = true;
        btnGitHub.innerHTML = `<span style="font-size:10px; font-weight:bold;">...</span>`;
        btnGitHub.style.opacity = '0.7';

        const reader = new FileReader();
        reader.onload = async (e) => { inputFile.value = ''; await ejecutarInyeccionConHTML(e.target.result); };
        reader.readAsText(file);
    });
})();
