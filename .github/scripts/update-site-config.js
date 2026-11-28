// Reads and updates src/siteConfig.json for the "Update site links & info" workflow in
// the Actions tab (.github/workflows/site-settings.yml).
//
// Each form box is passed in as an environment variable (SETTING_INSTAGRAM,
// etc.). If every box is left as it is, this lists the current settings.
// Otherwise it saves the filled-in boxes: blank boxes keep their current
// value, and nothing is saved if any box has a problem.
//
// To test on your computer, set the SETTING_ variables and run
// `node .github/scripts/update-site-config.js`, or add --show to list the
// current settings.

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'src', 'siteConfig.json');

// The applications dropdown's choices, and what each one sets
const KEEP = 'Leave as is';
const OPEN_CHOICES = { 'Open applications': true, 'Close applications': false };

// The link boxes on the form. `site` limits a box to one website, so a link
// can't be pasted into the wrong social media box.
const LINKS = [
    { env: 'SETTING_APPLICATION_FORM', key: 'applicationForm', label: 'Application form link (Join Us page)' },
    { env: 'SETTING_MODELLING_FORM', key: 'modellingForm', label: 'Modelling Service request form link' },
    { env: 'SETTING_FACEBOOK', key: 'facebook', label: 'Facebook link (footer)', site: 'facebook.com' },
    { env: 'SETTING_INSTAGRAM', key: 'instagram', label: 'Instagram link (footer)', site: 'instagram.com' },
    { env: 'SETTING_LINKEDIN', key: 'linkedin', label: 'LinkedIn link (footer)', site: 'linkedin.com' },
    { env: 'SETTING_LINKTREE', key: 'linktree', label: 'Contact Us / Linktree link (home page)' },
    { env: 'SETTING_SPONSORSHIP_PACKAGE', key: 'sponsorshipPackage', label: 'Sponsorship Package link (home page)' },
    { env: 'SETTING_DONATE_ORGANIZATIONS', key: 'donateOrganizations', label: 'Donation link for organizations (home page)' },
    { env: 'SETTING_DONATE_INDIVIDUALS', key: 'donateIndividuals', label: 'Donation link for individuals (home page)' },
];

const OPEN_LABEL = 'Applications open or closed (Join Us page)';
const YEAR_LABEL = 'Application year (Join Us page)';

function readInput(name) {
    return (process.env[name] || '').trim();
}

function describeOpen(isOpen) {
    return isOpen ? 'Open' : 'Closed';
}

// Every setting in the order the form shows them, with its current value
function currentSettings(config) {
    return [
        { label: OPEN_LABEL, value: describeOpen(config.applicationsOpen) },
        { label: YEAR_LABEL, value: config.applicationYear },
        ...LINKS.map((field) => ({ label: field.label, value: config.links[field.key] })),
    ];
}

// Adds what the person typed to an error message, so they can see what to fix
function problem(message, value) {
    return new Error(`${message} You entered: \`${value.replace(/`/g, "'")}\``);
}

// Returns the link with https:// at the start, or throws an error explaining
// what's wrong with it.
function cleanLink(value, { label, site }) {
    if (/\s/.test(value)) {
        throw problem(`${label} can't contain spaces.`, value);
    }

    let link;
    if (/^https?:\/\//i.test(value)) {
        link = value.replace(/^https?:\/\//i, 'https://');
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
        // Some other kind of address, like mailto: or ftp:
        throw problem(`${label} doesn't look like a web address.`, value);
    } else {
        link = `https://${value}`;
    }

    let hostname;
    try {
        hostname = new URL(link).hostname;
    } catch {
        throw problem(`${label} doesn't look like a web address.`, value);
    }
    if (!hostname.includes('.') || hostname.startsWith('.') || hostname.endsWith('.')) {
        throw problem(`${label} doesn't look like a web address.`, value);
    }
    if (site && hostname !== site && !hostname.endsWith(`.${site}`)) {
        throw problem(`${label} must be a link to ${site}.`, value);
    }
    return link;
}

// The year can be one year (2027) or two years in a row written any common
// way (2027/28, 2027/2028, 2027-28, 2027 - 2028). It's saved as typed.
function cleanYear(value) {
    const single = value.match(/^(\d{4})$/);
    const range = value.match(/^(\d{4})\s*[/\-–—]\s*(\d{2}|\d{4})$/);
    const first = Number((single || range || [])[1]);

    let valid = first >= 2000 && first <= 2099;
    if (valid && range) {
        const second = Number(range[2]);
        valid = range[2].length === 2 ? second === (first + 1) % 100 : second === first + 1;
    }
    if (!valid) {
        throw problem(`${YEAR_LABEL} must be a year like 2027, or two years in a row like 2027/28 or 2027/2028.`, value);
    }
    return value;
}

function writeSummary(markdown) {
    console.log(markdown);
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    }
}

function setOutput(name, value) {
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
    }
}

// Stops a | in a value from breaking the Markdown table.
function tableCell(value) {
    return String(value).replace(/\|/g, '\\|');
}

function settingsTable(config) {
    return [
        '| Setting | Current value |',
        '| --- | --- |',
        ...currentSettings(config).map((s) => `| ${s.label} | ${tableCell(s.value)} |`),
    ].join('\n');
}

// Every setting, with the new value filled in and marked for the ones that changed
function updateTable(config, changes) {
    const newValues = new Map(changes.map((c) => [c.label, c.new]));
    return [
        '| Setting | Current value | New value |',
        '| --- | --- | --- |',
        ...currentSettings(config).map((s) => (newValues.has(s.label)
            ? `| ✏️ **${s.label}** | ${tableCell(s.value)} | **${tableCell(newValues.get(s.label))}** |`
            : `| ${s.label} | ${tableCell(s.value)} | |`)),
    ].join('\n');
}

// Only the settings that changed, for the pull request description
function changesTable(changes) {
    return [
        '| Setting | Old | New |',
        '| --- | --- | --- |',
        ...changes.map((c) => `| ${c.label} | ${tableCell(c.old)} | ${tableCell(c.new)} |`),
    ].join('\n');
}

function update() {
    const original = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(original);
    const before = JSON.parse(original);
    const changes = [];
    const problems = [];

    const open = readInput('SETTING_APPLICATIONS_OPEN');
    const year = readInput('SETTING_APPLICATION_YEAR');
    const filledIn = (open && open !== KEEP) || year || LINKS.some((field) => readInput(field.env));

    // Nothing filled in: just show the current settings
    if (!filledIn) {
        show();
        setOutput('changed', 'false');
        return;
    }

    if (open && open !== KEEP) {
        if (!(open in OPEN_CHOICES)) {
            problems.push(problem(`${OPEN_LABEL} must be "${KEEP}", "Open applications" or "Close applications".`, open).message);
        } else if (OPEN_CHOICES[open] !== config.applicationsOpen) {
            changes.push({ label: OPEN_LABEL, old: describeOpen(config.applicationsOpen), new: describeOpen(OPEN_CHOICES[open]) });
            config.applicationsOpen = OPEN_CHOICES[open];
        }
    }

    if (year) {
        try {
            const cleaned = cleanYear(year);
            if (cleaned !== config.applicationYear) {
                changes.push({ label: YEAR_LABEL, old: config.applicationYear, new: cleaned });
                config.applicationYear = cleaned;
            }
        } catch (error) {
            problems.push(error.message);
        }
    }

    for (const field of LINKS) {
        const value = readInput(field.env);
        if (!value) {
            continue;
        }
        try {
            const cleaned = cleanLink(value, field);
            if (cleaned !== config.links[field.key]) {
                changes.push({ label: field.label, old: config.links[field.key], new: cleaned });
                config.links[field.key] = cleaned;
            }
        } catch (error) {
            problems.push(error.message);
        }
    }

    if (problems.length > 0) {
        writeSummary([
            '## ❌ Nothing was changed',
            '',
            'Fix these boxes and run the workflow again:',
            '',
            ...problems.map((problem) => `- ${problem}`),
            '',
            '### Current site links & info',
            '',
            settingsTable(before),
        ].join('\n'));
        setOutput('changed', 'false');
        process.exitCode = 1;
        return;
    }

    if (changes.length === 0) {
        writeSummary([
            '## Nothing to change',
            '',
            "Everything you filled in already matches what's on the site, so no pull request was created.",
            '',
            '### Current site links & info',
            '',
            settingsTable(before),
        ].join('\n'));
        setOutput('changed', 'false');
        return;
    }

    // Keep the file's line endings and the blank lines at the end, so the
    // pull request only shows the settings that changed
    const lineEnding = original.includes('\r\n') ? '\r\n' : '\n';
    const fileEnding = original.match(/\s*$/)[0];
    const json = JSON.stringify(config, null, 2).replace(/\n/g, lineEnding);
    fs.writeFileSync(CONFIG_PATH, json + fileEnding);
    setOutput('changed', 'true');

    // The workflow adds the pull request link above this table once the pull
    // request exists, so on GitHub the table goes to a file instead
    const table = updateTable(before, changes);
    if (process.env.CHANGES_SUMMARY_FILE) {
        fs.writeFileSync(process.env.CHANGES_SUMMARY_FILE, table);
    } else {
        writeSummary(['## ✅ Site links & info updated', '', table].join('\n'));
    }

    if (process.env.PR_BODY_FILE) {
        const requestedBy = process.env.GITHUB_ACTOR ? ` by @${process.env.GITHUB_ACTOR}` : '';
        fs.writeFileSync(process.env.PR_BODY_FILE, [
            `Requested${requestedBy} using the **Update site links & info** workflow in the Actions tab.`,
            '',
            changesTable(changes),
            '',
            'Before merging, click each new link to check it goes to the right page.',
            'After merging, run **Deploy to GitHub Pages** to update the live site.',
        ].join('\n'));
    }
}

function show() {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    writeSummary([
        '## Current site links & info',
        '',
        settingsTable(config),
        '',
        'To change any of these, run **Update site links & info** again and fill in only the boxes you want to change.',
    ].join('\n'));
}

if (process.argv.includes('--show')) {
    show();
} else {
    update();
}
