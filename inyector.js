;
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
        const etiqueta = meta ? `${meta.materia.toUpperCase()} · Cap ${meta.num}` : 'V36';

        const raiz = crearElemento('div', {
            position: 'fixed', bottom: '28px', right: '0', zIndex: '9999',
            display: 'flex', alignItems: 'center', fontFamily: 'system-ui, sans-serif'
        }, { className: 'tm-inyectado' });

        ui.panel = crearPanelMenu();
        ui.contadorDefensa = crearContadorDefensa();
        ui.selectModo = crearSelectorModo();
        ui.btnGitHub = crearBotonGitHub();
        ui.btnLocal = crearBotonLocal();
        ui.btnCerrar = crearBotonCerrar();
        ui.btnPestana = crearPestana();
        ui.inputFile = crearInputArchivo();

        const fila = crearElemento('div', { display: 'flex', alignItems: 'center', gap: '6px' });
        fila.append(ui.selectModo, ui.btnGitHub, ui.btnLocal, ui.btnCerrar);
        ui.panel.append(crearSeccionInfo(etiqueta), ui.contadorDefensa, fila);
        raiz.append(ui.panel, ui.btnPestana);

        document.body.appendChild(raiz);
        document.body.appendChild(ui.inputFile);
    }

    function alternarMenu() {
        estado.menuAbierto = !estado.menuAbierto;
        ui.panel.style.display = estado.menuAbierto ? 'flex' : 'none';
        if (estado.menuAbierto && estado.esperaDefensaActiva) {
            actualizarContadorPanel();
        }
    }

    function mostrarProgreso(texto) {
        ui.btnGitHub.innerHTML = `<span style="font-size:10px; font-weight:bold;">${texto}</span>`;
    }

    function bloquearUI() {
        ui.btnGitHub.disabled = true;
        ui.btnLocal.disabled = true;
        ui.selectModo.disabled = true;
        ui.btnGitHub.style.opacity = '0.7';
        mostrarProgreso('...');
    }

    function resetearUI() {
        desactivarEscudoFoco();
        if (estado.cancelado) return;
        ui.btnGitHub.disabled = false;
        ui.btnLocal.disabled = false;
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

    async function procesarModoEnCurso(doc) {
        const ej = encontrarEjercicioCorriendo();
        if (!ej) { showToast('No hay ningún ejercicio corriendo en este momento.', 'warning'); return; }

        const emisor = buscarEjercicioEmisor(doc, ej);
        if (!emisor && necesitaDocumento(ej)) { showToast('Este ejercicio no existe en el archivo.', 'warning'); return; }
        const objetivo = emisor ? varianteDe(emisor) : null;

        mostrarProgreso(1);
        if (objetivo === null || coincideVariante(ej, objetivo)) {
            await rellenarContenidoEjercicio(ej, emisor);
        }
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
     * Genera el ejercicio forzando la variante del emisor, rellena y corrige una sola vez.
     */
    async function procesarEjercicio(doc, ej) {
        const emisor = buscarEjercicioEmisor(doc, ej);
        if (!emisor && necesitaDocumento(ej)) return false;
        const objetivo = emisor ? varianteDe(emisor) : null;

        for (let intento = 0; intento < CONFIG.MAX_INTENTOS; intento++) {
            if (estado.cancelado) return false;

            await iniciarOReiniciar(ej, intento, objetivo);
            if (estado.cancelado) return false;

            if (objetivo !== null && !coincideVariante(ej, objetivo)) {
                console.warn(`[Inyector] ${ej.id}: salió variante ${varianteDe(ej)}, se esperaba ${objetivo}.`);
                await clickCorregir(ej);
                continue;
            }

            await rellenarContenidoEjercicio(ej, emisor);
            await clickCorregir(ej);
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
        else if (procesados === 0) showToast('Ningún ejercicio coincide con el archivo.', 'warning');
    }

    // =========================================================================
    // 17. ORQUESTADOR PRINCIPAL
    // =========================================================================
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
        document.addEventListener('click', interceptarGenerarDefensa, true);
        ui.btnCerrar.addEventListener('click', limpiarRastro);
        ui.btnPestana.addEventListener('click', alternarMenu);
        ui.btnGitHub.addEventListener('click', alClickGitHub);
        ui.btnLocal.addEventListener('click', alClickLocal);
        ui.inputFile.addEventListener('change', alElegirArchivo);
    }

    function iniciar() {
        envolverSavePage();
        instalarForzadoDeVariante();
        construirUI();
        conectarEventos();
    }

    iniciar();
})();
