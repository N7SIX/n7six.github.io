
const customFileInputDiv = document.getElementById('customFileInputDiv');
const customFileInput = document.getElementById('customFileInput');
const customFileLabel = document.getElementById('customFileLabel');
const flashButton = document.getElementById('flashButton');
const radioProfileSelect = document.getElementById('radioProfile');
const profileHelp = document.getElementById('profileHelp');
const engineBadge = document.getElementById('engineBadge');
const flashButtonText = document.querySelector('#flashButton .text');
const radioProfileLabel = document.querySelector('label[for="radioProfile"]');

let rawVersion = null; // stores the raw version data for fwpack.js and qsflash.js
let rawFirmware = null; // stores the raw firmware data for qsflash.js

const PROFILE_DEFAULT = 'k1k5-v3';
const MODERN_FLASHER_PATH = '../UVTools/index.html';
const LEGACY_I18N = {
    en: {
        radioFamilyLabel: 'Radio Family',
        profileK5K6V1: 'UV-K5/K6 Version 1',
        profileK5K6V2: 'UV-K5/K6 Version 2',
        profileK1K5V3: 'UV-K1 Series/K5 Version 3',
        profileHelpV1: 'Use this page for UV-K5/K6 Version 1 firmware.',
        profileHelpV2: 'Use this page for UV-K5/K6 Version 2 firmware.',
        profileHelpV3: 'This profile uses the modern UVTools flasher page. Click flash to continue.',
        badgeLegacy: 'Legacy engine',
        badgeModern: 'Modern engine',
        badgeTipLegacy: 'Flashing stays on this page using the legacy engine.',
        badgeTipModern: 'Flashing will open the modern UVTools page for this profile.',
        buttonFlash: 'Flash firmware',
        buttonOpenModern: 'Open modern flasher'
    },
    fr: {
        radioFamilyLabel: 'Famille de radio',
        profileK5K6V1: 'UV-K5/K6 Version 1',
        profileK5K6V2: 'UV-K5/K6 Version 2',
        profileK1K5V3: 'Série UV-K1/K5 Version 3',
        profileHelpV1: 'Utilisez cette page pour les firmwares UV-K5/K6 Version 1.',
        profileHelpV2: 'Utilisez cette page pour les firmwares UV-K5/K6 Version 2.',
        profileHelpV3: 'Ce profil utilise la page de flash moderne UVTools. Cliquez sur flasher pour continuer.',
        badgeLegacy: 'Moteur legacy',
        badgeModern: 'Moteur moderne',
        badgeTipLegacy: 'Le flash reste sur cette page avec le moteur legacy.',
        badgeTipModern: 'Le flash ouvrira la page moderne UVTools pour ce profil.',
        buttonFlash: 'Flasher le firmware',
        buttonOpenModern: 'Ouvrir le flasher moderne'
    },
    zh: {
        radioFamilyLabel: '对讲机系列',
        profileK5K6V1: 'UV-K5/K6 Version 1',
        profileK5K6V2: 'UV-K5/K6 Version 2',
        profileK1K5V3: 'UV-K1 系列/K5 Version 3',
        profileHelpV1: '此页面用于 UV-K5/K6 Version 1 固件。',
        profileHelpV2: '此页面用于 UV-K5/K6 Version 2 固件。',
        profileHelpV3: '此配置使用现代 UVTools 刷机页面。点击刷写继续。',
        badgeLegacy: '旧版引擎',
        badgeModern: '现代引擎',
        badgeTipLegacy: '刷写将留在当前页面，使用旧版引擎。',
        badgeTipModern: '此配置刷写时会打开现代 UVTools 页面。',
        buttonFlash: '写入固件',
        buttonOpenModern: '打开现代刷机页面'
    }
};

function resolveLang() {
    const params = new URLSearchParams(window.location.search);
    const requested = (params.get('lang') || navigator.language || 'en').toLowerCase();
    if (requested.startsWith('fr')) return 'fr';
    if (requested.startsWith('zh')) return 'zh';
    return 'en';
}

const activeLang = resolveLang();

function tr(key) {
    const dict = LEGACY_I18N[activeLang] || LEGACY_I18N.en;
    return dict[key] || LEGACY_I18N.en[key] || key;
}

const PROFILE_CONFIG = {
    'k5k6-v1': {
        engine: 'legacy',
        helpKey: 'profileHelpV1'
    },
    'k5k6-v2': {
        engine: 'legacy',
        helpKey: 'profileHelpV2'
    },
    'k1k5-v3': {
        engine: 'modern',
        helpKey: 'profileHelpV3'
    }
};

function updateStaticLocalizedUI() {
    if (radioProfileLabel) radioProfileLabel.textContent = tr('radioFamilyLabel');

    if (radioProfileSelect) {
        const optionV1 = radioProfileSelect.querySelector('option[value="k5k6-v1"]');
        const optionV2 = radioProfileSelect.querySelector('option[value="k5k6-v2"]');
        const optionV3 = radioProfileSelect.querySelector('option[value="k1k5-v3"]');
        if (optionV1) optionV1.textContent = tr('profileK5K6V1');
        if (optionV2) optionV2.textContent = tr('profileK5K6V2');
        if (optionV3) optionV3.textContent = tr('profileK1K5V3');
    }
}

function getSelectedProfileId() {
    const profileId = radioProfileSelect?.value || PROFILE_DEFAULT;
    return PROFILE_CONFIG[profileId] ? profileId : PROFILE_DEFAULT;
}

function getSelectedProfile() {
    const profileId = getSelectedProfileId();
    return { id: profileId, ...PROFILE_CONFIG[profileId] };
}

function applyProfileFromQuery() {
    if (!radioProfileSelect) return;
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    const profile = urlParams.get('profile');
    if (profile && PROFILE_CONFIG[profile]) {
        radioProfileSelect.value = profile;
    }
}

function buildModernFlasherUrl() {
    const target = new URL(MODERN_FLASHER_PATH, window.location.href);
    const sourceParams = new URLSearchParams(window.location.search);
    const firmwareURL = sourceParams.get('firmwareURL');

    if (firmwareURL) {
        target.searchParams.set('firmwareURL', firmwareURL);
    }

    target.searchParams.set('profile', 'k1k5-v3');
    return target.toString();
}

function applyProfileUI() {
    const profile = getSelectedProfile();
    const isLegacy = profile.engine === 'legacy';

    if (profileHelp) profileHelp.textContent = tr(profile.helpKey);
    if (engineBadge) {
        const badgeText = isLegacy ? tr('badgeLegacy') : tr('badgeModern');
        const badgeTooltip = isLegacy ? tr('badgeTipLegacy') : tr('badgeTipModern');
        engineBadge.textContent = badgeText;
        engineBadge.title = badgeTooltip;
        engineBadge.setAttribute('aria-label', `${badgeText}. ${badgeTooltip}`);
        engineBadge.classList.toggle('badge-warning', isLegacy);
        engineBadge.classList.toggle('badge-success', !isLegacy);
    }
    if (flashButtonText) flashButtonText.textContent = isLegacy ? tr('buttonFlash') : tr('buttonOpenModern');
    if (customFileInput) customFileInput.disabled = !isLegacy;
    if (customFileInputDiv) {
        customFileInputDiv.classList.toggle('disabled', !isLegacy);
    }

    if (!isLegacy) {
        flashButton.classList.remove('disabled');
    } else if (!rawFirmware) {
        flashButton.classList.add('disabled');
    }
}

if (radioProfileSelect) {
    radioProfileSelect.addEventListener('change', applyProfileUI);
}

updateStaticLocalizedUI();
applyProfileFromQuery();
applyProfileUI();


function loadFW(encoded_firmware)
{
    const flashButton = document.getElementById('flashButton');
    
    flashButton.classList.add('disabled');

    const unpacked_firmware = unpack(encoded_firmware);

    log(`Detected firmware version: ${new TextDecoder().decode(rawVersion.subarray(0, rawVersion.indexOf(0)))}`);

    rawFirmware = unpacked_firmware;

    // Check size
    const current_size = rawFirmware.length;
    const max_size = 0xEFFF;
    const percentage = (current_size / max_size) * 100;
    log(`Firmware uses ${percentage.toFixed(2)}% of available memory (${current_size}/${max_size} bytes).`);
    if (current_size > max_size) {
        log("WARNING: Firmware is too large and WILL NOT WORK!\nTry disabling mods that take up extra memory.");
        return;
    }

    flashButton.classList.remove('disabled');
}

function loadFirmwareFromUrl(theUrl)
{
    $("#spinner").removeClass("d-none");

    document.getElementById('console').value = "";
    log("Loading file from url: "+ theUrl+'\n')
    let res = null;

    fetch('https://api.codetabs.com/v1/proxy?quest=' + theUrl).catch(err => {
    return new Promise(resolve => setTimeout(resolve, 1000))
        .then(() => fetch('https://api.codetabs.com/v1/proxy?quest=' + theUrl));
    })
    .then(res => {
        if (res.ok) {
            return res.arrayBuffer();
        } else {
            log(`Http error: ${res.status}`);
            throw new Error(`Http error: ${res.status}`);
        }
    }).then(encoded_firmware => {
        loadFW(new Uint8Array(encoded_firmware));
        customFileLabel.textContent = theUrl.substring(theUrl.lastIndexOf('/')+1);
    }).catch((error) => {
        console.error(error);
        log('Error while loading firmware, check log above or developer console for details.');
    }).finally(()=>{
        $("#spinner").addClass("d-none");
    });
}


// Update text to show filename after file selection
customFileInput.addEventListener('change', function () {
    document.getElementById('console').value = "";
    // Check if a file is selected
    if (this.files.length > 0) {
        // Get the name of the selected file and update the label text
        customFileLabel.textContent = this.files[0].name;
        log("");
        const file = new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = function (event) {
                    resolve(new Uint8Array(event.target.result));
                };
                reader.readAsArrayBuffer(customFileInput.files[0]);
            });
    
        file
            .then((encoded_firmware) => {
                loadFW(encoded_firmware)
            })
            .catch((error) => {
                console.error(error);
                log('Error while loading firmware, check log above or developer console for details.');
            });
    } else {
        // If no file is selected, reset the label text
        customFileLabel.textContent = 'Select firmware file';
    }
});




// flasher

async function flash_init(port) {
    const decoder = new TextDecoder();
    // example version data: { 0x30, 0x5, 0x10, 0x0, '2', '.', '0', '1', '.', '2', '3', 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0} for version 2.01.23
    // version from the fw file is stored in the 16 byte uint8array rawVersion starting with the version string at index 0, padded with 0x00
    // seems like the version string is just sent after a 4 byte header, so we can just send the rawVersion array

    const data = new Uint8Array([0x30, 0x5, rawVersion.length, 0x0, ...rawVersion]);
    // const data = new Uint8Array([0x30, 0x5, 0x10, 0x0, 0x32, 0x2e, 0x30, 0x31, 0x2e, 0x32, 0x33, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0]); //send v2 just like in k5prog
    console.log('Sending version request: ', data);

    await sendPacket(port, data);

    const response = await readPacket(port, 0x18);
    console.log('Version Response: ', response);
    if (response[0] == 0x18) {
        return response;
    }
    return Promise.reject('Maximum attempts reached, no response was 0x18. Aborting.');
}

// function to check if the version of the firmware is compatible with the bootloader (it does not actually matter lol)
function flash_checkVersion(dataPacket, versionFromFirmware) {
    const decoder = new TextDecoder();
    // print bootloader version as string, located at index 0x14
    log(`Bootloader version: ${decoder.decode(dataPacket.slice(0x14, 0x14 + 7))}`);

    // the radio accepts a * wildcard version, so we will do the same
    if (versionFromFirmware[0] == 0x2a) return true;

    // dataPacket is a uint8array containing the relevant byte at index 0x14
    // this byte is a 2 for the uv-k5, 3 for the k5(8)/k6, 4 for the uv-5r plus
    // versionFromFirmware is a uint8array containing the version at index 0, padded with 0x00
    return dataPacket[0x14] == versionFromFirmware[0];
}

// function to create a flash command from a block of data (max 0x100 bytes), the address and the total size of the firmware file
function flash_generateCommand(data, address, totalSize) {
    // the flash command structure is as follows:
    /* 0x19  0x5  0xc  0x1  0x8a  0x8d  0x9f  0x1d  
     * address_msb  address_lsb  address_final_msb  address_final_lsb  length_msb  length_lsb  0x0  0x0 
     * [0x100 bytes of data, if length is <0x100 then fill the rest with zeroes] */

    // flash is written in 0x100 blocks, if data is less than 0x100 bytes then it is padded with zeroes
    if (data.length < 0x100) {
        const padding = new Uint8Array(0x100 - data.length);
        data = new Uint8Array([...data, ...padding]);
    }
    if (data.length != 0x100) throw new Error('Tell matt that he is an idiot');

    // the address is a 16 bit integer, so we need to split it into two bytes
    const address_msb = (address & 0xff00) >> 8;
    const address_lsb = address & 0xff;

    const address_final = (totalSize + 0xff) & ~0xff; // add 0xff to totalSize and then round down to the next multiple of 0x100 by stripping the last byte
    if (address_final > 0xf000) throw new Error('Total size is too large');
    const address_final_msb = (address_final & 0xff00) >> 8;
    const address_final_lsb = 0x0; // since address_final can only be a multiple of 0x100, address_final_lsb is always 0x0

    // the length is fixed to 0x100 bytes
    const length_msb = 0x01;
    const length_lsb = 0x00;

    return new Uint8Array([0x19, 0x5, 0xc, 0x1, 0x8a, 0x8d, 0x9f, 0x1d, address_msb, address_lsb, address_final_msb, address_final_lsb, length_msb, length_lsb, 0x0, 0x0, ...data]);
}

// function to flash the firmware file to the radio
async function flash_flashFirmware(port, firmware) {
    // for loop to flash the firmware in 0x100 byte blocks
    // this loop is safe as long as the firmware file is smaller than 0xf000 bytes
    if (firmware.length > 0xefff) throw new Error('Last resort boundary check failed. Whoever touched the code is an idiot.');
    log('Flashing... 0%')

    for (let i = 0; i < firmware.length; i += 0x100) {
        const data = firmware.slice(i, i + 0x100);
        const command = flash_generateCommand(data, i, firmware.length);

        try {
            await sendPacket(port, command);
            await readPacket(port, 0x1a);
        } catch (e) {
            log('Flash command rejected. Aborting.');
            return Promise.reject(e);
        }

        log(`Flashing... ${((i / firmware.length) * 100).toFixed(1)}%`, true);
    }
    log('Flashing... 100%', true)
    log('Successfully flashed firmware.');
    return Promise.resolve();
}

flashButton.addEventListener('click', async function () {
    const profile = getSelectedProfile();
    if (profile.engine === 'modern') {
        window.location.href = buildModernFlasherUrl();
        return;
    }

    flashButton.classList.add('disabled');
    if (!rawFirmware) {
        log('Please select a firmware file first.');
        flashButton.classList.add('disabled');
        return;
    }
    if (rawFirmware.length > 0xefff) {
        log('Firmware file is too large. Aborting.');
        flashButton.classList.remove('disabled');
        return;
    }
    log('Connecting to the serial port...');
    const port = await connect();
    if (!port) {
        log('Failed to connect to the serial port.');
        flashButton.classList.remove('disabled');
        return;
    }

    try {
        const data = await readPacket(port, 0x18, 1000);
        if (data[0] == 0x18) {
            console.log('Received 0x18 packet. Radio is ready for flashing.');
            console.log('0x18 packet data: ', data);
            log('Radio in flash mode detected.');

            const response = await flash_init(port);
            if (flash_checkVersion(response, rawVersion)) {
                log('Version check passed.');
            } else {
                log('WARNING: Version check failed! Please select the correct version. Aborting.');
                return;
            }
            log('Flashing firmware...');
            await flash_flashFirmware(port, rawFirmware);

            return;
        } else {
            console.log('Received unexpected packet. Radio is not ready for flashing.');
            log('Wrong packet received, is the radio in flash mode?');
            console.log('Data: ', data);
            return;
        }
    } catch (error) {
        if (error !== 'Reader has been cancelled.') {
            console.error('Error:', error);
            log('Unusual error occured, check console for details.');
        } else {
            log('No data received, is the radio connected and in flash mode? Please try again.');
        }
        return;

    } finally {
        port.close();
        flashButton.classList.remove('disabled');
    }
});
