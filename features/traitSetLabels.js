(configuration, events, skillCache, skillSetCache, elementCreator) => {

    let enabled = false;
    let observer = null;

    function initialise() {
        elementCreator.addStyles(styles);
        configuration.registerCheckbox({
            category: 'Traits',
            key: 'trait-set-labels',
            name: 'Show Skill Set Labels',
            default: true,
            handler: state => {
                enabled = state;
                handlePage(events.getLast('page'));
            }
        });
        events.register('page', handlePage);
    }

    function handlePage(page) {
        if(observer) {
            observer.disconnect();
            observer = null;
        }
        if(!enabled || page?.type !== 'traits' || page?.menu !== 'traits') {
            document.querySelectorAll('traits-page .trait-set-label').forEach(label => label.remove());
            return;
        }
        // Watch above the page so delayed rendering and replacement of the page
        // or its cards are handled as well as changes to individual rows.
        observer = new MutationObserver(updateLabels);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        updateLabels();
    }

    function updateLabels() {
        const labelledRows = new Set();
        document.querySelectorAll('traits-page .groups > * > .card').forEach(card => {
            const name = card.querySelector('.header > .name')?.textContent.trim();
            if(name !== 'Traits' && name !== 'Equipped') {
                return;
            }
            card.querySelectorAll('button.row').forEach(row => {
                const title = row.querySelector('.title')?.textContent.trim().toLowerCase();
                const level = row.querySelector('.level');
                const skill = skillCache.list.find(skill => title?.startsWith(`${skill.displayName.toLowerCase()} `));
                const sets = skill && ['Forest', 'Mountain', 'Ocean']
                    .map(name => skillSetCache.byName[name])
                    .filter(set => set?.skills.includes(skill.id));
                if(!level || !sets?.length) {
                    return;
                }
                labelledRows.add(row);
                const text = sets.length === 3 ? 'All Sets' : sets.map(set => set.name).join(' / ');
                let label = row.querySelector('.trait-set-label');
                if(!label) {
                    label = document.createElement('span');
                    label.className = 'trait-set-label';
                }
                // Idempotent writes let the observer settle, including when the
                // sort/filter feature reacts to an inserted label by moving rows.
                if(label.textContent !== text) {
                    label.textContent = text;
                }
                if(label.nextElementSibling !== level || label.parentNode !== level.parentNode) {
                    level.before(label);
                }
            });
        });
        document.querySelectorAll('traits-page .trait-set-label').forEach(label => {
            if(!labelledRows.has(label.closest('button.row'))) {
                label.remove();
            }
        });
    }

    const styles = `
        traits-page .trait-set-label {
            display: inline-block;
            flex: 0 0 4.5em;
            width: 4.5em;
            margin-inline: 0.5em;
            font-size: 0.8em;
            font-weight: normal;
            text-align: center;
            white-space: nowrap;
            opacity: 0.8;
            pointer-events: none;
        }
        traits-page .trait-set-label + .level {
            flex: 0 0 4.5em !important;
            width: 4.5em !important;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
        }
        /* Equipped rows show changing XP in .level. Reserve its column so
           digit changes cannot push the set label sideways. Priority keeps
           later game flex rules from restoring content-based sizing. */
        traits-page .description ~ .trait-set-label + .level {
            flex-basis: 9em !important;
            width: 9em !important;
            white-space: normal;
            overflow-wrap: anywhere;
        }
        @media (max-width: 600px) {
            traits-page .trait-set-label {
                margin-inline: 0.25em;
                font-size: 0.75em;
            }
            traits-page button.row:has(> .description ~ .trait-set-label) {
                flex-wrap: wrap;
            }
            traits-page .description ~ .trait-set-label + .level {
                flex-basis: calc(100% - var(--margin)) !important;
                width: calc(100% - var(--margin)) !important;
            }
        }
    `;

    initialise();
}
