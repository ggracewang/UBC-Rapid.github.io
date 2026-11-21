// Reads and updates src/siteConfig.json for the Actions tab workflows.
//
// update-site-settings.yml runs this with each form box passed in as an
// environment variable (SETTING_INSTAGRAM, etc.). Blank boxes keep their
// current value, and nothing is saved if any box has a problem.
//
// show-site-settings.yml runs it with --show to list the current settings.

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'src', 'siteConfig.json');

// The link boxes on the form. `site` limits a box to one website, so a link
// can't be pasted into the wrong social media box.
const LINKS = [
    { env: 'SETTING_APPLICATION_FORM', key: 'applicationForm', label: 'Join Us Page – application form link' },
    { env: 'SETTING_MODELLING_FORM', key: 'modellingForm', label: 'Modelling Service Page – Request Now form link' },
    { env: 'SETTING_FACEBOOK', key: 'facebook', label: 'Footer – Facebook link', site: 'facebook.com' },
    { env: 'SETTING_INSTAGRAM', key: 'instagram', label: 'Footer – Instagram link', site: 'instagram.com' },
    { env: 'SETTING_LINKEDIN', key: 'linkedin', label: 'Footer – LinkedIn link', site: 'linkedin.com' },
    { env: 'SETTING_LINKTREE', key: 'linktree', label: 'Home Page – Contact Us (Linktree) link' },
    { env: 'SETTING_SPONSORSHIP_PACKAGE', key: 'sponsorshipPackage', label: 'Home Page – Sponsorship Package link' },
    { env: 'SETTING_DONATE_ORGANIZATIONS', key: 'donateOrganizations', label: 'Home Page – donation link for organizations' },
    { env: 'SETTING_DONATE_INDIVIDUALS', key: 'donateIndividuals', label: 'Home Page – donation link for individuals' },
];

const OPEN_LABEL = 'Join Us Page – applications open';
const YEAR_LABEL = 'Join Us Page – application year';

function readInput(name) {
    return (process.env[name] || '').trim();
}

function describeOpen(isOpen) {
    return isOpen ? 'Open' : 'Closed';
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
    const changes = [];
    const problems = [];

    const open = readInput('SETTING_APPLICATIONS_OPEN');
    if (open && open !== 'No change') {
        if (open !== 'Open' && open !== 'Closed') {
            problems.push(`${OPEN_LABEL} must be "No change", "Open" or "Closed".`);
        } else if ((open === 'Open') !== config.applicationsOpen) {
            changes.push({ label: OPEN_LABEL, old: describeOpen(config.applicationsOpen), new: open });
            config.applicationsOpen = open === 'Open';
        }
    }

    const year = readInput('SETTING_APPLICATION_YEAR');
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
            '## Nothing was changed',
            '',
            'Fix these boxes and run the workflow again:',
            '',
            ...problems.map((problem) => `- ${problem}`),
        ].join('\n'));
        setOutput('changed', 'false');
        process.exitCode = 1;
        return;
    }

    if (changes.length === 0) {
        writeSummary([
            '## Nothing to change',
            '',
            'All boxes were blank or matched the current settings, so no pull request was created.',
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

    const table = changesTable(changes);
    writeSummary(['## Site settings updated', '', table].join('\n'));

    if (process.env.PR_BODY_FILE) {
        const requestedBy = process.env.GITHUB_ACTOR ? ` by @${process.env.GITHUB_ACTOR}` : '';
        fs.writeFileSync(process.env.PR_BODY_FILE, [
            `Requested${requestedBy} using the **Update site settings** form in the Actions tab.`,
            '',
            table,
            '',
            'Before merging, click each new link to check it goes to the right page.',
            'After merging, run **Deploy to GitHub Pages** to update the live site.',
        ].join('\n'));
    }
}

function show() {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const rows = [
        [OPEN_LABEL, describeOpen(config.applicationsOpen)],
        [YEAR_LABEL, config.applicationYear],
        ...LINKS.map((field) => [field.label, config.links[field.key]]),
    ];
    writeSummary([
        '## Current site settings',
        '',
        '| Setting | Current value |',
        '| --- | --- |',
        ...rows.map(([label, value]) => `| ${label} | ${tableCell(value)} |`),
        '',
        'To change any of these, run **Update site settings** in the Actions tab.',
    ].join('\n'));
}

if (process.argv.includes('--show')) {
    show();
} else {
    update();
}
