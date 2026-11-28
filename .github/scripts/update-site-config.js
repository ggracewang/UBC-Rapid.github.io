// Reads and updates src/siteConfig.json for the "Site settings" workflow in
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

// Returns the link with https:// at the start, or throws an error explaining
// what's wrong with it.
function cleanLink(value, { label, site }) {
    if (/\s/.test(value)) {
        throw new Error(`${label} can't contain spaces.`);
    }

    let link;
    if (/^https?:\/\//i.test(value)) {
        link = value.replace(/^https?:\/\//i, 'https://');
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
        // Some other kind of address, like mailto: or ftp:
        throw new Error(`${label} doesn't look like a web address.`);
    } else {
        link = `https://${value}`;
    }

    let hostname;
    try {
        hostname = new URL(link).hostname;
    } catch {
        throw new Error(`${label} doesn't look like a web address.`);
    }
    if (!hostname.includes('.') || hostname.startsWith('.') || hostname.endsWith('.')) {
        throw new Error(`${label} doesn't look like a web address.`);
    }
    if (site && hostname !== site && !hostname.endsWith(`.${site}`)) {
        throw new Error(`${label} must be a link to ${site}.`);
    }
    return link;
}

// The year must look like 2027/28, with the second year right after the first.
function cleanYear(value) {
    const match = value.match(/^(\d{4})\/(\d{2})$/);
    if (!match || Number(match[2]) !== (Number(match[1]) + 1) % 100) {
        throw new Error(`${YEAR_LABEL} must look like 2027/28.`);
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
            problems.push(`${OPEN_LABEL} must be "${KEEP}", "Open applications" or "Close applications".`);
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
            '### Current settings',
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
            'Everything you filled in already matches the current settings, so no pull request was created.',
            '',
            '### Current settings',
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

    writeSummary([
        '## ✅ Site settings updated',
        '',
        'A pull request with these changes was opened. Its link is at the bottom of this page.',
        '',
        updateTable(before, changes),
    ].join('\n'));

    if (process.env.PR_BODY_FILE) {
        const requestedBy = process.env.GITHUB_ACTOR ? ` by @${process.env.GITHUB_ACTOR}` : '';
        fs.writeFileSync(process.env.PR_BODY_FILE, [
            `Requested${requestedBy} using the **Site settings** workflow in the Actions tab.`,
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
        '## Current site settings',
        '',
        settingsTable(config),
        '',
        'To change any of these, run **Site settings** again and fill in only the boxes you want to change.',
    ].join('\n'));
}

if (process.argv.includes('--show')) {
    show();
} else {
    update();
}
