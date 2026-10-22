// -----------------------------------------------------------------------------
// Every text the container sends to Gladys, in the four languages of its
// interface. Entries are strings or functions of one parameter object. German
// says "du", Spanish "usted" (test/i18n.test.js).
//
// Configuration actions answer with a multi-language object (Gladys shows the
// user's language); feature names, widget texts and scene outputs use the
// `language` of the configuration, or the language the widget request carries.
// -----------------------------------------------------------------------------

export const LANGS = ['en', 'fr', 'de', 'es'];

// Feature names, frozen at creation in Gladys.
export const NAMES = {
  en: {
    reachable: 'Reachable',
    load: 'Load (1 min)',
    memory: 'Memory used',
    disk: 'Disk used (/)',
    uptime: 'Uptime',
  },
  fr: {
    reachable: 'Joignable',
    load: 'Charge (1 min)',
    memory: 'Mémoire utilisée',
    disk: 'Disque utilisé (/)',
    uptime: 'Durée de fonctionnement',
  },
  de: {
    reachable: 'Erreichbar',
    load: 'Last (1 Min.)',
    memory: 'Belegter Speicher',
    disk: 'Belegte Festplatte (/)',
    uptime: 'Betriebszeit',
  },
  es: {
    reachable: 'Accesible',
    load: 'Carga (1 min)',
    memory: 'Memoria usada',
    disk: 'Disco usado (/)',
    uptime: 'Tiempo encendido',
  },
};

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Connection status when the private key of the configuration is unusable.
export const KEY_STATUS = {
  keyInvalid: {
    en: 'The private key of the configuration is unreadable: paste an OpenSSH or PEM key, or empty the field.',
    fr: 'La clé privée de la configuration est illisible : collez une clé OpenSSH ou PEM, ou videz le champ.',
    de: 'Der private Schlüssel der Konfiguration ist unlesbar: Füge einen OpenSSH- oder PEM-Schlüssel ein oder leere das Feld.',
    es: 'La clave privada de la configuración es ilegible: pegue una clave OpenSSH o PEM, o vacíe el campo.',
  },
  keyPassphrase: {
    en: 'The private key of the configuration is encrypted: its passphrase is missing or wrong.',
    fr: 'La clé privée de la configuration est chiffrée : sa phrase de passe manque ou est fausse.',
    de: 'Der private Schlüssel der Konfiguration ist verschlüsselt: Seine Passphrase fehlt oder ist falsch.',
    es: 'La clave privada de la configuración está cifrada: falta su frase de contraseña o es incorrecta.',
  },
};

// Why a session failed (codes: src/ssh.js REASONS).
export const REASON_TEXT = {
  en: {
    timeout: 'no answer (address, port or firewall)',
    refused: 'connection refused (is the SSH server running on this port?)',
    unreachable: 'host unreachable',
    dns: 'unknown host name',
    auth: 'authentication refused (public key not authorized, or wrong password)',
    host_key_changed: 'the host key changed: connection refused',
    error: 'SSH error',
  },
  fr: {
    timeout: 'pas de réponse (adresse, port ou pare-feu)',
    refused: 'connexion refusée (le serveur SSH écoute-t-il sur ce port ?)',
    unreachable: 'hôte injoignable',
    dns: "nom d'hôte inconnu",
    auth: 'authentification refusée (clé publique non autorisée ou mot de passe faux)',
    host_key_changed: "la clé d'hôte a changé : connexion refusée",
    error: 'erreur SSH',
  },
  de: {
    timeout: 'keine Antwort (Adresse, Port oder Firewall)',
    refused: 'Verbindung abgelehnt (läuft der SSH-Server auf diesem Port?)',
    unreachable: 'Host nicht erreichbar',
    dns: 'unbekannter Hostname',
    auth: 'Anmeldung abgelehnt (öffentlicher Schlüssel nicht autorisiert oder falsches Passwort)',
    host_key_changed: 'der Host-Schlüssel hat sich geändert: Verbindung abgelehnt',
    error: 'SSH-Fehler',
  },
  es: {
    timeout: 'sin respuesta (dirección, puerto o cortafuegos)',
    refused: 'conexión rechazada (¿escucha el servidor SSH en este puerto?)',
    unreachable: 'equipo inaccesible',
    dns: 'nombre de equipo desconocido',
    auth: 'autenticación rechazada (clave pública no autorizada o contraseña incorrecta)',
    host_key_changed: 'la clave del equipo ha cambiado: conexión rechazada',
    error: 'error SSH',
  },
};

// Validation errors of the configuration actions (keys: src/hosts.js).
export const ERRORS = {
  en: {
    name: 'Give the host a name.',
    nameLength: ({ max }) => `The name is too long (${max} characters at most).`,
    address: ({ value }) => `"${value}" is not an IP address or a host name.`,
    port: ({ value }) => `"${value}" is not a TCP port (1 to 65535).`,
    username: 'Enter the user name to log in with.',
    tooManyHosts: ({ max }) => `The list is full (${max} hosts).`,
    unknownHost: ({ value }) => `No host is named "${value}".`,
    hostMissing: 'Choose the host in the list, or type its name.',
    hostConflict: ({ listed, typed }) =>
      `The list says ${listed} but the name says ${typed}: keep only one.`,
    deviceUnlinked:
      'This device is no longer linked to a host: add the host again, or remove the device in Gladys.',
    commandName: 'Give the command a name.',
    command: 'Enter the command to run.',
    commandLength: ({ max }) => `The command is too long (${max} characters at most).`,
    kind: 'Choose what the command is: an action, a number or a text.',
    reservedName: ({ value }) => `"${value}" is the name of a standard feature: choose another.`,
    tooManyCommands: ({ max }) => `This host has ${max} commands already.`,
    unknownCommand: ({ value, host }) => `${host} has no command named "${value}".`,
    keyInvalid: 'The private key of the configuration is unreadable.',
    keyPassphrase: 'The passphrase of the private key is missing or wrong.',
    nameTaken: ({ value }) =>
      `This name is too close to "${value}", already saved: choose another one, or use exactly "${value}" to update it.`,
  },
  fr: {
    name: "Donnez un nom à l'hôte.",
    nameLength: ({ max }) => `Le nom est trop long (${max} caractères au plus).`,
    address: ({ value }) => `« ${value} » n'est ni une adresse IP ni un nom d'hôte.`,
    port: ({ value }) => `« ${value} » n'est pas un port TCP (1 à 65535).`,
    username: "Saisissez le nom d'utilisateur de connexion.",
    tooManyHosts: ({ max }) => `La liste est pleine (${max} hôtes).`,
    unknownHost: ({ value }) => `Aucun hôte ne s'appelle « ${value} ».`,
    hostMissing: "Choisissez l'hôte dans la liste, ou saisissez son nom.",
    hostConflict: ({ listed, typed }) =>
      `La liste indique ${listed} mais le nom indique ${typed} : n'en gardez qu'un.`,
    deviceUnlinked:
      "Cet appareil n'est plus lié à un hôte : ajoutez de nouveau l'hôte, ou supprimez l'appareil dans Gladys.",
    commandName: 'Donnez un nom à la commande.',
    command: 'Saisissez la commande à lancer.',
    commandLength: ({ max }) => `La commande est trop longue (${max} caractères au plus).`,
    kind: 'Choisissez ce qu’est la commande : une action, un nombre ou un texte.',
    reservedName: ({ value }) =>
      `« ${value} » est le nom d'une fonctionnalité standard : choisissez-en un autre.`,
    tooManyCommands: ({ max }) => `Cet hôte a déjà ${max} commandes.`,
    unknownCommand: ({ value, host }) => `${host} n'a pas de commande « ${value} ».`,
    keyInvalid: 'La clé privée de la configuration est illisible.',
    keyPassphrase: 'La phrase de passe de la clé privée manque ou est fausse.',
    nameTaken: ({ value }) =>
      `Ce nom est trop proche de « ${value} », déjà enregistré : choisissez-en un autre, ou reprenez exactement « ${value} » pour le modifier.`,
  },
  de: {
    name: 'Gib dem Host einen Namen.',
    nameLength: ({ max }) => `Der Name ist zu lang (höchstens ${max} Zeichen).`,
    address: ({ value }) => `„${value}“ ist weder eine IP-Adresse noch ein Hostname.`,
    port: ({ value }) => `„${value}“ ist kein TCP-Port (1 bis 65535).`,
    username: 'Gib den Benutzernamen für die Anmeldung ein.',
    tooManyHosts: ({ max }) => `Die Liste ist voll (${max} Hosts).`,
    unknownHost: ({ value }) => `Kein Host heißt „${value}“.`,
    hostMissing: 'Wähle den Host in der Liste oder gib seinen Namen ein.',
    hostConflict: ({ listed, typed }) =>
      `Die Liste nennt ${listed}, der Name aber ${typed}: Behalte nur eines.`,
    deviceUnlinked:
      'Dieses Gerät ist mit keinem Host mehr verbunden: Füge den Host erneut hinzu oder lösche das Gerät in Gladys.',
    commandName: 'Gib dem Befehl einen Namen.',
    command: 'Gib den auszuführenden Befehl ein.',
    commandLength: ({ max }) => `Der Befehl ist zu lang (höchstens ${max} Zeichen).`,
    kind: 'Wähle, was der Befehl ist: eine Aktion, eine Zahl oder ein Text.',
    reservedName: ({ value }) =>
      `„${value}“ ist der Name einer Standardfunktion: Wähle einen anderen.`,
    tooManyCommands: ({ max }) => `Dieser Host hat schon ${max} Befehle.`,
    unknownCommand: ({ value, host }) => `${host} hat keinen Befehl „${value}“.`,
    keyInvalid: 'Der private Schlüssel der Konfiguration ist unlesbar.',
    keyPassphrase: 'Die Passphrase des privaten Schlüssels fehlt oder ist falsch.',
    nameTaken: ({ value }) =>
      `Dieser Name ist zu nah an „${value}“, das schon gespeichert ist: Wähle einen anderen oder nimm genau „${value}“, um es zu ändern.`,
  },
  es: {
    name: 'Dé un nombre al equipo.',
    nameLength: ({ max }) => `El nombre es demasiado largo (${max} caracteres como máximo).`,
    address: ({ value }) => `«${value}» no es una dirección IP ni un nombre de equipo.`,
    port: ({ value }) => `«${value}» no es un puerto TCP (de 1 a 65535).`,
    username: 'Introduzca el nombre de usuario para conectarse.',
    tooManyHosts: ({ max }) => `La lista está llena (${max} equipos).`,
    unknownHost: ({ value }) => `Ningún equipo se llama «${value}».`,
    hostMissing: 'Elija el equipo en la lista o escriba su nombre.',
    hostConflict: ({ listed, typed }) =>
      `La lista indica ${listed} pero el nombre indica ${typed}: conserve solo uno.`,
    deviceUnlinked:
      'Este dispositivo ya no está vinculado a un equipo: vuelva a añadir el equipo o elimine el dispositivo en Gladys.',
    commandName: 'Dé un nombre al comando.',
    command: 'Introduzca el comando que se ejecutará.',
    commandLength: ({ max }) => `El comando es demasiado largo (${max} caracteres como máximo).`,
    kind: 'Elija qué es el comando: una acción, un número o un texto.',
    reservedName: ({ value }) => `«${value}» es el nombre de una función estándar: elija otro.`,
    tooManyCommands: ({ max }) => `Este equipo ya tiene ${max} comandos.`,
    unknownCommand: ({ value, host }) => `${host} no tiene ningún comando «${value}».`,
    keyInvalid: 'La clave privada de la configuración es ilegible.',
    keyPassphrase: 'Falta la frase de contraseña de la clave privada o es incorrecta.',
    nameTaken: ({ value }) =>
      `Este nombre es demasiado parecido a «${value}», ya guardado: elija otro, o use exactamente «${value}» para modificarlo.`,
  },
};

// Reports of the configuration actions.
export const REPORTS = {
  en: {
    hostSaved: ({ name }) => `${name} saved.`,
    connected: ({ user, fingerprint }) =>
      `Connected as ${user}. Host key ${fingerprint} remembered: compare it with "ssh-keygen -lf" on the machine.`,
    connectedKnown: ({ user }) => `Connected as ${user}, host key checked.`,
    failed: ({ reason }) => `Connection failed: ${reason}.`,
    authHint:
      'Copy the public key (action "Show the public key") into ~/.ssh/authorized_keys of this user.',
    keyChangedHint:
      'If the machine was reinstalled, run "Accept a new host key", then save the host again.',
    discover: 'Then create its device in the Discover tab.',
    hostRemoved: ({ name }) => `${name} removed. Its device stays in Gladys until you delete it.`,
    commandSaved: ({ name, host }) => `"${name}" saved on ${host}.`,
    updateDevice: 'Click "Update" on the device in the Discover tab to get the new feature.',
    tried: ({ value }) => `First read: ${value}.`,
    triedFailed: ({ output }) => `First read failed: ${output}`,
    commandRemoved: ({ name, host }) => `"${name}" removed from ${host}.`,
    hostKeyForgotten: ({ name }) =>
      `Host key of ${name} forgotten: the next connection remembers the new one.`,
    publicKey: ({ source }) =>
      source === 'config'
        ? 'Public key of the private key in the configuration:'
        : 'Public key of the integration (generated at the first start):',
    authorizedKeys: 'Add this line to ~/.ssh/authorized_keys of the user, on each machine:',
    empty: 'No host yet: add one with "Add or update a host".',
    listHost: ({ name, user, address, port, state }) =>
      `${name}: ${user}@${address}:${port}, ${state}`,
    online: 'reachable',
    offline: 'unreachable',
    notChecked: 'not checked yet',
    noCommand: 'no command',
  },
  fr: {
    hostSaved: ({ name }) => `${name} enregistré.`,
    connected: ({ user, fingerprint }) =>
      `Connecté en tant que ${user}. Clé d'hôte ${fingerprint} mémorisée : comparez-la avec « ssh-keygen -lf » sur la machine.`,
    connectedKnown: ({ user }) => `Connecté en tant que ${user}, clé d'hôte vérifiée.`,
    failed: ({ reason }) => `La connexion a échoué : ${reason}.`,
    authHint:
      'Copiez la clé publique (action « Afficher la clé publique ») dans ~/.ssh/authorized_keys de cet utilisateur.',
    keyChangedHint:
      "Si la machine a été réinstallée, lancez « Accepter une nouvelle clé d'hôte », puis enregistrez de nouveau l'hôte.",
    discover: "Créez ensuite son appareil dans l'onglet Découverte.",
    hostRemoved: ({ name }) =>
      `${name} retiré. Son appareil reste dans Gladys jusqu'à ce que vous le supprimiez.`,
    commandSaved: ({ name, host }) => `« ${name} » enregistrée sur ${host}.`,
    updateDevice:
      "Cliquez sur « Mettre à jour » sur l'appareil dans l'onglet Découverte pour obtenir la nouvelle fonctionnalité.",
    tried: ({ value }) => `Première lecture : ${value}.`,
    triedFailed: ({ output }) => `La première lecture a échoué : ${output}`,
    commandRemoved: ({ name, host }) => `« ${name} » retirée de ${host}.`,
    hostKeyForgotten: ({ name }) =>
      `Clé d'hôte de ${name} oubliée : la prochaine connexion mémorise la nouvelle.`,
    publicKey: ({ source }) =>
      source === 'config'
        ? 'Clé publique de la clé privée de la configuration :'
        : "Clé publique de l'intégration (générée au premier démarrage) :",
    authorizedKeys:
      "Ajoutez cette ligne à ~/.ssh/authorized_keys de l'utilisateur, sur chaque machine :",
    empty: 'Aucun hôte pour l’instant : ajoutez-en un avec « Ajouter ou modifier un hôte ».',
    listHost: ({ name, user, address, port, state }) =>
      `${name} : ${user}@${address}:${port}, ${state}`,
    online: 'joignable',
    offline: 'injoignable',
    notChecked: 'pas encore testé',
    noCommand: 'aucune commande',
  },
  de: {
    hostSaved: ({ name }) => `${name} gespeichert.`,
    connected: ({ user, fingerprint }) =>
      `Verbunden als ${user}. Host-Schlüssel ${fingerprint} gemerkt: Vergleiche ihn mit „ssh-keygen -lf“ auf dem Rechner.`,
    connectedKnown: ({ user }) => `Verbunden als ${user}, Host-Schlüssel geprüft.`,
    failed: ({ reason }) => `Verbindung fehlgeschlagen: ${reason}.`,
    authHint:
      'Kopiere den öffentlichen Schlüssel (Aktion „Öffentlichen Schlüssel anzeigen“) in ~/.ssh/authorized_keys dieses Benutzers.',
    keyChangedHint:
      'Wurde der Rechner neu installiert, starte „Neuen Host-Schlüssel akzeptieren“ und speichere den Host dann erneut.',
    discover: 'Lege dann sein Gerät im Tab „Entdecken“ an.',
    hostRemoved: ({ name }) => `${name} entfernt. Sein Gerät bleibt in Gladys, bis du es löschst.`,
    commandSaved: ({ name, host }) => `„${name}“ auf ${host} gespeichert.`,
    updateDevice:
      'Klicke im Tab „Entdecken“ beim Gerät auf „Aktualisieren“, um die neue Funktion zu bekommen.',
    tried: ({ value }) => `Erster Wert: ${value}.`,
    triedFailed: ({ output }) => `Erstes Lesen fehlgeschlagen: ${output}`,
    commandRemoved: ({ name, host }) => `„${name}“ von ${host} entfernt.`,
    hostKeyForgotten: ({ name }) =>
      `Host-Schlüssel von ${name} vergessen: Die nächste Verbindung merkt sich den neuen.`,
    publicKey: ({ source }) =>
      source === 'config'
        ? 'Öffentlicher Schlüssel des privaten Schlüssels der Konfiguration:'
        : 'Öffentlicher Schlüssel der Integration (beim ersten Start erzeugt):',
    authorizedKeys:
      'Füge diese Zeile auf jedem Rechner in ~/.ssh/authorized_keys des Benutzers ein:',
    empty: 'Noch kein Host: Füge einen mit „Host hinzufügen oder ändern“ hinzu.',
    listHost: ({ name, user, address, port, state }) =>
      `${name}: ${user}@${address}:${port}, ${state}`,
    online: 'erreichbar',
    offline: 'nicht erreichbar',
    notChecked: 'noch nicht geprüft',
    noCommand: 'kein Befehl',
  },
  es: {
    hostSaved: ({ name }) => `${name} guardado.`,
    connected: ({ user, fingerprint }) =>
      `Conectado como ${user}. Clave del equipo ${fingerprint} memorizada: compárela con «ssh-keygen -lf» en la máquina.`,
    connectedKnown: ({ user }) => `Conectado como ${user}, clave del equipo verificada.`,
    failed: ({ reason }) => `La conexión ha fallado: ${reason}.`,
    authHint:
      'Copie la clave pública (acción «Mostrar la clave pública») en ~/.ssh/authorized_keys de ese usuario.',
    keyChangedHint:
      'Si la máquina se ha reinstalado, ejecute «Aceptar una nueva clave del equipo» y vuelva a guardar el equipo.',
    discover: 'Después, cree su dispositivo en la pestaña Descubrir.',
    hostRemoved: ({ name }) =>
      `${name} quitado. Su dispositivo permanece en Gladys hasta que lo elimine.`,
    commandSaved: ({ name, host }) => `«${name}» guardado en ${host}.`,
    updateDevice:
      'Haga clic en «Actualizar» en el dispositivo de la pestaña Descubrir para obtener la nueva función.',
    tried: ({ value }) => `Primera lectura: ${value}.`,
    triedFailed: ({ output }) => `La primera lectura ha fallado: ${output}`,
    commandRemoved: ({ name, host }) => `«${name}» quitado de ${host}.`,
    hostKeyForgotten: ({ name }) =>
      `Clave del equipo ${name} olvidada: la próxima conexión memoriza la nueva.`,
    publicKey: ({ source }) =>
      source === 'config'
        ? 'Clave pública de la clave privada de la configuración:'
        : 'Clave pública de la integración (generada en el primer arranque):',
    authorizedKeys: 'Añada esta línea a ~/.ssh/authorized_keys del usuario, en cada máquina:',
    empty: 'Aún no hay equipos: añada uno con «Añadir o modificar un equipo».',
    listHost: ({ name, user, address, port, state }) =>
      `${name}: ${user}@${address}:${port}, ${state}`,
    online: 'accesible',
    offline: 'inaccesible',
    notChecked: 'aún sin comprobar',
    noCommand: 'ningún comando',
  },
};

// Results of a command run from the widget (a toast, 200 characters at most)
// or failing in a scene.
export const RUNS = {
  en: {
    ok: ({ name }) => `${name}: done`,
    failed: ({ name, code }) => `${name}: failed (exit code ${code})`,
    timedOut: ({ name, seconds }) => `${name}: stopped after ${seconds} s`,
    unreachable: ({ name, reason }) => `${name} not run: ${reason}`,
    disconnected: ({ name }) => `${name}: sent, then the connection closed (normal for a reboot)`,
    gone: 'This command is no longer in the configuration.',
  },
  fr: {
    ok: ({ name }) => `${name} : terminé`,
    failed: ({ name, code }) => `${name} : échec (code de retour ${code})`,
    timedOut: ({ name, seconds }) => `${name} : arrêté après ${seconds} s`,
    unreachable: ({ name, reason }) => `${name} non lancé : ${reason}`,
    disconnected: ({ name }) =>
      `${name} : envoyée, puis la connexion s'est fermée (normal pour un redémarrage)`,
    gone: "Cette commande n'est plus dans la configuration.",
  },
  de: {
    ok: ({ name }) => `${name}: erledigt`,
    failed: ({ name, code }) => `${name}: fehlgeschlagen (Rückgabewert ${code})`,
    timedOut: ({ name, seconds }) => `${name}: nach ${seconds} s gestoppt`,
    unreachable: ({ name, reason }) => `${name} nicht ausgeführt: ${reason}`,
    disconnected: ({ name }) =>
      `${name}: gesendet, dann wurde die Verbindung geschlossen (normal bei einem Neustart)`,
    gone: 'Dieser Befehl ist nicht mehr in der Konfiguration.',
  },
  es: {
    ok: ({ name }) => `${name}: terminado`,
    failed: ({ name, code }) => `${name}: error (código de salida ${code})`,
    timedOut: ({ name, seconds }) => `${name}: detenido tras ${seconds} s`,
    unreachable: ({ name, reason }) => `${name} no ejecutado: ${reason}`,
    disconnected: ({ name }) =>
      `${name}: enviado y, después, la conexión se cerró (normal en un reinicio)`,
    gone: 'Este comando ya no está en la configuración.',
  },
};

// Dashboard widget texts (short: a status label or value, a button).
export const WIDGET_TEXT = {
  empty: {
    en: 'No host yet: add one in the configuration of the SSH integration, then create its device.',
    fr: "Aucun hôte pour l'instant : ajoutez-en un dans la configuration de l'intégration SSH, puis créez son appareil.",
    de: 'Noch kein Host: Füge einen in der Konfiguration der SSH-Integration hinzu und lege dann sein Gerät an.',
    es: 'Aún no hay equipos: añada uno en la configuración de la integración SSH y cree su dispositivo.',
  },
  state: { en: 'SSH', fr: 'SSH', de: 'SSH', es: 'SSH' },
  online: { en: 'Reachable', fr: 'Joignable', de: 'Erreichbar', es: 'Accesible' },
  offline: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
  unknown: {
    en: 'Not checked yet',
    fr: 'Pas encore testé',
    de: 'Noch nicht geprüft',
    es: 'Aún sin comprobar',
  },
  load: { en: 'Load', fr: 'Charge', de: 'Last', es: 'Carga' },
  memory: { en: 'Memory', fr: 'Mémoire', de: 'Speicher', es: 'Memoria' },
  disk: { en: 'Disk', fr: 'Disque', de: 'Festplatte', es: 'Disco' },
  uptime: { en: 'Uptime', fr: 'Allumé depuis', de: 'Läuft seit', es: 'Encendido desde' },
  days: { en: 'd', fr: 'j', de: 'T', es: 'd' },
  hours: { en: 'h', fr: 'h', de: 'Std.', es: 'h' },
};

/** A table entry rendered in every language: `{ en, fr, de, es }`. */
export function say(table, key, params = {}) {
  return Object.fromEntries(
    LANGS.map((lang) => {
      const entry = table[lang][key];
      return [lang, typeof entry === 'function' ? entry(params) : entry];
    }),
  );
}

/** Joins multi-language objects line by line (empty entries skipped). */
export function lines(...parts) {
  return Object.fromEntries(
    LANGS.map((lang) => [
      lang,
      parts
        .filter(Boolean)
        .map((part) => (typeof part === 'string' ? part : part[lang]))
        .filter(Boolean)
        .join('\n'),
    ]),
  );
}

/** A user mistake: answered (multi-language), not thrown up to Gladys. */
export class UserError extends Error {
  constructor(key, params = {}) {
    super(ERRORS.en[key] instanceof Function ? ERRORS.en[key](params) : ERRORS.en[key]);
    this.messages = say(ERRORS, key, params);
  }
}
