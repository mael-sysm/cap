// ==UserScript==
// @name         Inyector Maestro V33.2 (RAM + CodeMirror V32 Clásico)
// @namespace    http://tampermonkey.net/
// @version      33.2
// @description  Tipos 0-4 desde RAM. Calculadoras y Diagramas con el motor exacto de la V32.12 (Cupos, GoJS, esperas dinámicas).
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
    const GITHUB_USER   = 'mael-sysm';
    const GITHUB_REPO   = 'cap';
    const GITHUB_BRANCH = 'main';

    const MAX_INTENTOS = 15;
    const VERIFICAR_DIAGRAMA = true;

    let cancelado = false;
    let cacheHTMLGitHub = null;

    // =========================================================================
    // MODULO 0: INTERCEPTOR DE VARIANTES
    // =========================================================================
    const hookVariantesId = setInterval(() => {
        if (typeof window.Ejercicio !== 'undefined' && typeof window.Capitulo !== 'undefined' && !window.Ejercicio.prototype._tm_hooked) {
            const generarOriginal = window.Ejercicio.prototype.generarEjercicio;
            window.Ejercicio.prototype.generarEjercicio = function() {
                if (window.Capitulo.reg && window.Capitulo.reg[window.Ejercicio.neg]) {
                    window.Capitulo.reg[window.Ejercicio.neg][0] = 0; 
                }
                
                let totalVariantes = this.enunciados ? this.enunciados.length : 1;
                let inputVar = document.getElementById('tm-variante');
                let varDeseada = inputVar ? (parseInt(inputVar.value, 10) || 0) : 0;
                
                if (varDeseada >= totalVariantes) varDeseada = totalVariantes > 0 ? totalVariantes - 1 : 0;

                const randomOriginal = Math.random;
                Math.random = () => (varDeseada + 0.1) / totalVariantes;
                
                const resultado = generarOriginal.apply(this, arguments);
                Math.random = randomOriginal;
                
                console.log("[INYECTOR] Variante forzada al indice: " + varDeseada);
                return resultado;
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
    // MODULO 1: LIMPIEZA Y EVENTOS
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
    // MODULO 2: DESCARGA GITHUB Y METADATOS
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

        const candidatosDirectos = [`${baseRaw}/${num}.html`, `${baseRaw}/${meta.capitulo}.html`, `${baseRaw}/${numPad}.html`];

        for (const url of candidatosDirectos) {
            try {
                const r = await fetch(url, { cache: 'no-store' });
                if (r.ok) return (cacheHTMLGitHub = await r.text());
            } catch (e) {}
        }

        const apiUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${meta.materia}?ref=${GITHUB_BRANCH}`;
        const respApi = await fetch(apiUrl, { cache: 'no-store' });
        if (!respApi.ok) throw new Error(`[ERROR] Carpeta ${meta.materia} no encontrada.`);

        const archivos = await respApi.json();
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

        if (!archivoElegido) throw new Error(`[ERROR] Archivo ${num} no hallado en GitHub.`);

        const urlFinal = archivoElegido.download_url || `${baseRaw}/${encodeURIComponent(archivoElegido.name)}`;
        const respHtml = await fetch(urlFinal, { cache: 'no-store' });
        if (!respHtml.ok) throw new Error(`[ERROR] Fallo al descargar ${archivoElegido.name}`);

        return (cacheHTMLGitHub = await respHtml.text());
    }

    // =========================================================================
    // MODULO 3: UTILIDADES COMUNES
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
            fontFamily: 'monospace', fontSize: '13px', fontWeight: '500',
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

    const esVisible = el => !!(el && (el.offsetParent || el.getClientRects().length));
    function obtenerNotaEjercicio(ej) {
        const inp = ej.querySelector('input.notas, input.itmostrar.notas');
        if (!inp) return 0;
        const val = parseFloat(inp.value || inp.getAttribute('value') || '0');
        return isNaN(val) ? 0 : val;
    }
    
    const textoInst = el => {
        const d = document.createElement('div');
        d.innerHTML = el.innerHTML.replace(/<br\s*[\/]?>/gi, '\n').replace(/<\/p>|<\/div>/gi, '\n');
        return d.textContent.replace(/\u200B/g, '').replace(/^\n+|\n+$/g, '');
    };
    
    const norm = t => (t || '').replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();

    // =========================================================================
    // MODULO 4: MOTOR CLÁSICO DE CALCULADORAS (V32.12 EXACTO)
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
                if (escape) escape = false;
                else if (ch === '\\') escape = true;
                else if (ch === '"') enCadena = false;
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
            el.dispatchEvent(new KeyboardEvent(tipo, {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                shiftKey: true, bubbles: true, cancelable: true
            })));
    }

    function inyectarModelo(d, modelo) {
        const m = d.model;
        d.startTransaction('InyeccionModelo');
        try {
            const enlacesViejos = [...m.linkDataArray];
            if (m.removeLinkDataCollection) m.removeLinkDataCollection(enlacesViejos);
            else enlacesViejos.forEach(l => m.removeLinkData(l));

            (modelo.nodeDataArray || []).forEach(src => {
                const texto = limpiarComodines(src.text);
                const nodo = m.findNodeDataForKey(src.key);
                if (nodo) {
                    if (src.text !== undefined) m.setDataProperty(nodo, 'text', texto);
                } else {
                    const copia = JSON.parse(JSON.stringify(src));
                    copia.text = texto;
                    m.addNodeData(copia);
                }
            });

            (modelo.linkDataArray || []).forEach(l => {
                const copia = JSON.parse(JSON.stringify(l));
                if (typeof copia.text === 'string') copia.text = limpiarComodines(copia.text);
                m.addLinkData(copia);
            });

            d.commitTransaction('InyeccionModelo');
            return true;
        } catch (e) {
            try { d.rollbackTransaction(); } catch (e2) {}
            return false;
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
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                shiftKey: true, bubbles: true, cancelable: true
            }));
            await sleep(120);
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

    async function inyectarCalculadoras(ejActual, ejResuelto) {
        const liveCalculadoras = Array.from(ejActual.querySelectorAll('.calculadora'));
        if (liveCalculadoras.length === 0) return { error: false, omitido: true };
        if (!ejResuelto) return { error: true, omitido: false };

        const sourceCalculadoras = Array.from(ejResuelto.querySelectorAll('.calculadora'));

        const srcDiag    = sourceCalculadoras.filter(esDiagramaSrc);
        const srcNoDiag  = sourceCalculadoras.filter(c => !esDiagramaSrc(c));
        const liveNoDiag = liveCalculadoras.filter(c => !esDiagramaVivo(c));

        const planPorCalc = new Map();
        if (liveNoDiag.length === srcNoDiag.length) {
            liveNoDiag.forEach((c, j) =>
                planPorCalc.set(c, Array.from(srcNoDiag[j].querySelectorAll('.instruccion')).map(textoInst)));
        } else {
            const todas = srcNoDiag
                .flatMap(c => Array.from(c.querySelectorAll('.instruccion')).map(textoInst))
                .filter(t => t);
            const cupo = liveNoDiag.map(c => Math.max(1,
                Array.from(c.querySelectorAll('.CodeMirror'))
                    .filter(cm => cm.CodeMirror && cm.CodeMirror.getValue().trim() !== '').length));
            liveNoDiag.forEach((c, j) =>
                planPorCalc.set(c, j === liveNoDiag.length - 1 ? todas.splice(0) : todas.splice(0, cupo[j])));
        }

        let diagramaFallo = false;
        let idxDiag = 0;
        for (const liveCalc of liveCalculadoras) {
            if (cancelado) return { error: false };
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
        return { error: diagramaFallo, omitido: false };
    }

    // =========================================================================
    // MODULO 5: DECODIFICADOR NATIVO EN RAM (TIPOS 0-4)
    // =========================================================================
    const b64 = {
        d: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz<>",
        d4c: function(e) {
            var t, r, a = [], i = "";
            for (let o = 0; o < 4; o++) { t = this.d.indexOf(e[3 - o]); for (let j = 0; j < 6; j++) a.unshift((t >> j) & 1); }
            let strBin = a.join("");
            for (let j = 0; j < 3; j++) { r = parseInt(strBin.slice(8 * j, 8 * (j + 1)), 2); i += String.fromCharCode(r); }
            return i;
        },
        d4cf: function(e) {
            var t, r, a = [], i = "";
            for (let o = 0; o < 4; o++) { t = (e[3 - o]) ? this.d.indexOf(e[3 - o]) : 0; for (let j = 0; j < 6; j++) a.unshift((t >> j) & 1); }
            let strBin = a.join("");
            for (let j = 0; j < 3; j++) { r = parseInt(strBin.slice(8 * j, 8 * (j + 1)), 2); if (r !== 0) i += String.fromCharCode(r); }
            return i;
        },
        decode: function(e) {
            var t = 0, o = "", r = "";
            while (t < e.length - 4) { o = e.substring(t, t + 4); r += this.d4c(o); t += 4; }
            o = e.substring(t, t + 4); r += this.d4cf(o);
            return r;
        }
    };

    async function inyectarDesdeMemoria(ejActualDOM) {
        if (typeof window.capitulo === 'undefined') return;
        
        let matchIndex = ejActualDOM.id.match(/\d+/);
        if (!matchIndex) return;
        let numIndex = parseInt(matchIndex[0], 10) - 1;
        
        let ejData = window.capitulo.ejercicios[numIndex];
        if (!ejData || !ejData.preguntas) return;
        
        let varianteIndex = parseInt(ejActualDOM.getAttribute('enunciado') || ejData.enunciado, 10) || 0;
        let preguntas = ejData.preguntas[varianteIndex];
        if (!preguntas) return;

        let literalesDOM = ejActualDOM.querySelectorAll('.campo_literal');
        let selectsDOM = ejActualDOM.querySelectorAll('.campo_arrastrar, .campo_dato');
        
        let iLit = 0; 
        let iSel = 0; 

        for (let idx = 0; idx < preguntas.length; idx++) {
            if (cancelado) return;
            let p = preguntas[idx];

            if (p.tipo === 4) {
                for (let i = 0; i < p.pregunta.campos.length; i++) {
                    let respuestaCorrecta = b64.decode(p.pregunta.campos[i][0]);
                    respuestaCorrecta = respuestaCorrecta.replace(/_\^/g, "").replace(/_\$/g, "");
                    
                    let campo = literalesDOM[iLit++];
                    if (campo) {
                        campo.focus();
                        campo.textContent = respuestaCorrecta;
                        campo.dispatchEvent(new Event('input', { bubbles: true }));
                        campo.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
                        campo.dispatchEvent(new Event('change', { bubbles: true }));
                        campo.blur();
                        await sleep(20);
                    }
                }
            } else if (p.tipo === 2 || p.tipo === 3) {
                for (let i = 0; i < p.pregunta.correctas.length; i++) {
                    let respuestaCorrecta = b64.decode(p.pregunta.correctas[i]);
                    let campo = selectsDOM[iSel++];
                    if (campo) campo.textContent = respuestaCorrecta;
                }
            } else if (p.tipo === 0) {
                let opcionVisibleCorrecta = p.pregunta.visibles.find(v => v[0] === p.pregunta.correcta[0]);
                if (opcionVisibleCorrecta) {
                    let radio = document.getElementById(opcionVisibleCorrecta[1]);
                    if (radio && !radio.checked) radio.click();
                }
            } else if (p.tipo === 1) {
                p.pregunta.forEach(opt => {
                    let checkbox = document.getElementById(opt.id);
                    if (checkbox) {
                        let debeEstarMarcado = (opt.tipo === 1);
                        if (debeEstarMarcado !== checkbox.checked) checkbox.click();
                    }
                });
            }
        }
        await sleep(50);
    }

    // =========================================================================
    // MODULO 6: ORQUESTADOR PRINCIPAL
    // =========================================================================
    async function ejecutarInyeccionGlobal(htmlTexto, soloRAM = false) {
        activarEscudoFoco();

        let doc = null;
        if (htmlTexto && !soloRAM) {
            try { doc = new DOMParser().parseFromString(htmlTexto, 'text/html'); } 
            catch (err) { showToast('[ERROR] HTML parse fallido.', 'error'); resetearBtn(); return; }
        }

        const liveEjercicios = Array.from(document.querySelectorAll('div.ejercicio[id]'));
        const modo = selectModo.value;
        let ejecutados = 0;

        for (let i = 0; i < liveEjercicios.length; i++) {
            if (cancelado) return;
            const ejActual = liveEjercicios[i];
            const id = ejActual.id;
            
            const btnGen = ejActual.querySelector('.btGenerar');
            const btnRep = ejActual.querySelector('.btRepetir');
            const activoG = !!(btnGen && esVisible(btnGen));
            const activoR = !!(btnRep && esVisible(btnRep));
            const nota = obtenerNotaEjercicio(ejActual);

            if (modo === 'sin_corregir' && (activoG || activoR)) continue;
            if (modo === 'no_iniciados' && (activoR || !activoG)) continue;
            if (modo === 'iniciados' && (!activoR || nota >= 100)) continue;
            if (modo === 'todos' && !activoG && !activoR) continue;

            btnGitHub.innerHTML = `<span style="font-size:10px; font-weight:bold;">${i + 1}</span>`;

            for (let intento = 0; intento < MAX_INTENTOS; intento++) {
                if (cancelado) return;

                const botonG = ejActual.querySelector('.btGenerar');
                const botonR = ejActual.querySelector('.btRepetir');
                const usarGenerar = (intento === 0 && botonG && esVisible(botonG) && !(botonR && esVisible(botonR)));
                const botonAccion = usarGenerar ? botonG : botonR;

                if (botonAccion) {
                    const antesHTML = ejActual.innerHTML;
                    botonAccion.click();
                    await esperarHasta(() => ejActual.innerHTML !== antesHTML, 3000);
                    await sleep(150);
                }

                const numEnunciado = ejActual.getAttribute('enunciado');
                let ejResuelto = doc ? doc.querySelector(`div.ejercicio[id="${id}"][enunciado="${numEnunciado}"]`) : null;

                const resCalc = await inyectarCalculadoras(ejActual, ejResuelto);
                if (resCalc.error && intento < MAX_INTENTOS - 1) continue;

                await inyectarDesdeMemoria(ejActual);

                const btnCorregir = ejActual.querySelector('.btCorregir, #btCorregir');
                if (btnCorregir) {
                    btnCorregir.removeAttribute('disabled');
                    btnCorregir.disabled = false;
                    btnCorregir.click();
                    await sleep(700);
                }
                
                ejecutados++;
                break;
            }
        }

        if (ejecutados === 0) showToast('[INFO] Ningun ejercicio requirio inyeccion.', 'warning');
        resetearBtn();
    }

    // =========================================================================
    // MODULO 7: INTERFAZ DE USUARIO (GUI)
    // =========================================================================
    const metaActual = obtenerMetadatosCapitulo();
    const etiquetaCap = metaActual ? `${metaActual.materia.toUpperCase()} CAP ${metaActual.num}` : 'V33.2';

    const contenedorRaiz = document.createElement('div');
    contenedorRaiz.className = 'tm-inyectado';
    Object.assign(contenedorRaiz.style, {
        position: 'fixed', bottom: '28px', right: '0', zIndex: '9999', display: 'flex', alignItems: 'center', fontFamily: 'monospace'
    });

    const panelMenu = document.createElement('div');
    Object.assign(panelMenu.style, {
        display: 'none', flexDirection: 'column', gap: '8px', background: 'rgba(15, 23, 42, 0.95)',
        padding: '10px 12px', border: '1px solid rgba(255,255,255,0.15)', borderRight: 'none'
    });

    const seccionInfo = document.createElement('div');
    seccionInfo.textContent = etiquetaCap;
    Object.assign(seccionInfo.style, { background: '#1e293b', color: '#38bdf8', padding: '5px 8px', fontSize: '11px', textAlign: 'center', border: '1px solid #334155' });

    const filaControles = document.createElement('div');
    Object.assign(filaControles.style, { display: 'flex', alignItems: 'center', gap: '6px' });

    const selectModo = document.createElement('select');
    Object.assign(selectModo.style, { padding: '4px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #475569', fontSize: '11px', outline: 'none' });
    ['no_iniciados', 'iniciados', 'sin_corregir', 'todos'].forEach((val, i) => {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = ['No Iniciados', 'Iniciados <100', 'Activo (Corriendo)', 'Todos'][i];
        selectModo.appendChild(opt);
    });

    const inputVariante = document.createElement('input');
    inputVariante.id = 'tm-variante';
    inputVariante.type = 'number';
    inputVariante.min = '0';
    inputVariante.value = '0';
    inputVariante.title = "Variante deseada (0 = Enunciado 1)";
    Object.assign(inputVariante.style, {
        width: '35px', padding: '4px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #475569', fontSize: '11px', textAlign: 'center', outline: 'none'
    });

    const btnGitHub = document.createElement('button');
    const iconoGH = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
    btnGitHub.innerHTML = iconoGH;
    btnGitHub.title = "Resolver Todo (GitHub + RAM)";
    Object.assign(btnGitHub.style, {
        width: '28px', height: '28px', background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
    });

    const btnRam = document.createElement('button');
    btnRam.textContent = 'RAM';
    btnRam.title = 'Resolver SOLO campos (0-4) desde Memoria. Ignora calculadoras.';
    Object.assign(btnRam.style, { padding: '4px 8px', background: '#059669', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' });

    const btnCerrar = document.createElement('button');
    btnCerrar.textContent = 'X';
    Object.assign(btnCerrar.style, { width: '24px', height: '24px', background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' });
    btnCerrar.addEventListener('click', limpiarRastro);

    const btnPestana = document.createElement('button');
    Object.assign(btnPestana.style, { width: '16px', height: '36px', background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', opacity: '0' });
    let menuAbierto = false;
    btnPestana.addEventListener('click', () => { menuAbierto = !menuAbierto; panelMenu.style.display = menuAbierto ? 'flex' : 'none'; });

    filaControles.append(inputVariante, selectModo, btnGitHub, btnRam, btnCerrar);
    panelMenu.append(seccionInfo, filaControles);
    contenedorRaiz.append(panelMenu, btnPestana);
    document.body.appendChild(contenedorRaiz);

    function resetearBtn() {
        desactivarEscudoFoco();
        if (cancelado) return;
        [btnGitHub, btnRam, selectModo, inputVariante].forEach(b => { b.disabled = false; b.style.opacity = '1'; });
        btnGitHub.innerHTML = iconoGH;
    }

    btnGitHub.addEventListener('click', async () => {
        if (btnGitHub.disabled) return;
        const meta = obtenerMetadatosCapitulo();
        if (!meta) { showToast('[ERROR] Metadatos no detectados.', 'error'); return; }

        [btnGitHub, btnRam, selectModo, inputVariante].forEach(b => { b.disabled = true; b.style.opacity = '0.7'; });
        btnGitHub.innerHTML = `<span style="font-size:10px;">...</span>`;

        try {
            const html = await descargarHTMLDesdeGitHub(meta);
            await ejecutarInyeccionGlobal(html, false);
        } catch (err) {
            showToast('[ERROR] Conexion GitHub fallida.', 'error');
            resetearBtn();
        }
    });

    btnRam.addEventListener('click', async () => {
        if (btnRam.disabled) return;
        [btnGitHub, btnRam, selectModo, inputVariante].forEach(b => { b.disabled = true; b.style.opacity = '0.7'; });
        btnRam.textContent = '...';
        await ejecutarInyeccionGlobal(null, true);
        btnRam.textContent = 'RAM';
    });
})();
