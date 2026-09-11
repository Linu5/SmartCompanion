// Developer-only validation. Never run the Auth fixtures against a real project.
// Uses an isolated, in-memory PostgreSQL engine; no network/database credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { PGlite } = require(path.join(root, '.cache/supabase-sql-check/node_modules/@electric-sql/pglite'));
const setup = fs.readFileSync(path.join(__dirname, 'railpulse-setup.sql'), 'utf8');
const verify = fs.readFileSync(path.join(__dirname, 'verify-setup.sql'), 'utf8');
const upgrade = fs.readFileSync(path.join(__dirname, 'add-saved-places.sql'), 'utf8');
const useUpgrade = process.argv.includes('--upgrade');
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const db = new PGlite();
const checks = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };

async function asUser(user, sql, params = [], role = 'authenticated') {
    assert.ok(['anon', 'authenticated'].includes(role));
    await db.exec(`begin; set local role ${role};`);
    try {
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user || '']);
        const result = await db.query(sql, params);
        await db.exec('commit');
        return result;
    } catch (error) {
        await db.exec('rollback');
        throw error;
    }
}
async function denied(name, action, code = '42501') {
    await assert.rejects(action, error => error.code === code, name);
    checks.push(name);
}

async function main() {
    // The shim models auth.uid() from a verified session claim. It does not test
    // Supabase's HTTP API, JWT verification, hosted Auth or email delivery.
    await db.exec(`
        create role anon nologin;
        create role authenticated nologin;
        create schema auth;
        create table auth.users (id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$
            select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
        grant usage on schema auth to anon, authenticated;
        grant execute on function auth.uid() to anon, authenticated;
        create table public.friend_notes (note text);
        insert into public.friend_notes values ('existing app data');
        grant select on public.friend_notes to anon;
        -- Emulate a project with broad legacy default table/function grants.
        alter default privileges in schema public grant all on tables to anon, authenticated;
        alter default privileges in schema public grant execute on functions to anon, authenticated;
    `);
    await db.query('insert into auth.users(id) values ($1), ($2)', [alice, bob]);
    const version = (await db.query('select version() as version')).rows[0].version;
    await denied('add-on fails safely when original setup is absent', async () => {
        try { await db.exec(upgrade); } catch (error) { await db.exec('rollback'); throw error; }
    }, 'P0001');
    check('failed add-on leaves no partially created table', (await db.query("select to_regclass('public.railpulse_saved_places') as table_id")).rows[0].table_id === null);
    await db.exec(setup);
    if (useUpgrade) {
        // Only in this isolated database: remove the new table to model the
        // previous four-table install, whose definitions are unchanged.
        await db.exec('drop table public.railpulse_saved_places');
        await asUser(alice, "insert into public.railpulse_profiles (display_name) values ('Existing commuter')");
        await asUser(alice, "insert into public.railpulse_preferences (theme) values ('dark')");
        await asUser(alice, "insert into public.railpulse_saved_routes (name, origin_id, destination_id) values ('Existing journey', 'EW24', 'EW23')");
        await asUser(alice, "insert into public.railpulse_favourite_buses (service_no, bus_stop_code) values ('12e', '01012')");
        const oldTables = ['railpulse_profiles', 'railpulse_preferences', 'railpulse_saved_routes', 'railpulse_favourite_buses'];
        const snapshots = await Promise.all(oldTables.map(table => db.query(`select * from public.${table}`)));
        await db.exec(upgrade);
        for (let i = 0; i < oldTables.length; i++) {
            assert.deepEqual((await db.query(`select * from public.${oldTables[i]}`)).rows, snapshots[i].rows);
            checks.push(`upgrade preserves existing ${oldTables[i]} data and timestamps`);
            await asUser(alice, `delete from public.${oldTables[i]}`);
        }
    }
    const results = await db.exec(verify);
    check('verification finds all five tables with expected policies, grants, foreign keys and triggers', results[0].rows.length === 5 && results[0].rows.every(row => Object.entries(row).every(([key, value]) => key === 'table_name' || value === true)));
    check('timestamp function is invoker-only and client RPC is denied', results[1].rows.length === 1 && Object.values(results[1].rows[0]).every(value => value === true));
    check('all 20 policies exist', results[2].rows.length === 20);
    check('existing unrelated data and grants are preserved', (await db.query("select note, has_table_privilege('anon', 'public.friend_notes', 'SELECT') as access from public.friend_notes")).rows[0].access === true);

    const fixtures = [
        { table: 'railpulse_profiles', columns: 'display_name', values: ['Commuter'], field: 'display_name' },
        { table: 'railpulse_preferences', columns: 'theme', values: ['dark'], field: 'theme', replacement: 'light' },
        { table: 'railpulse_saved_routes', columns: 'name, mode, origin_id, destination_id', values: ['School', 'train-only', 'EW24', 'EW23'], field: 'name' },
        { table: 'railpulse_favourite_buses', columns: 'service_no, bus_stop_code, label', values: ['12e', '01012', 'My bus'], field: 'label' },
        { table: 'railpulse_saved_places', columns: 'label, category, location_type, address, latitude, longitude', values: ['Home', 'home', 'address', 'Synthetic test address', 1.3, 103.8], field: 'label' }
    ];
    for (const f of fixtures) {
        const placeholders = f.values.map((_, i) => `$${i + 1}`).join(', ');
        const insert = `insert into public.${f.table} (${f.columns}) values (${placeholders}) returning *`;
        const initial = (await asUser(alice, insert, f.values)).rows[0];
        await asUser(bob, insert, f.values);
        check(`${f.table}: insert defaults to the signed-in owner`, initial.user_id === alice);
        check(`${f.table}: unfiltered select returns only own data`, (await asUser(alice, `select * from public.${f.table}`)).rows.every(row => row.user_id === alice));
        check(`${f.table}: another user's rows cannot be selected`, (await asUser(alice, `select * from public.${f.table} where user_id = $1`, [bob])).rows.length === 0);
        await denied(`${f.table}: forged ownership on insert is rejected`, () => asUser(alice, `insert into public.${f.table} (${f.columns}, user_id) values (${placeholders}, $${f.values.length + 1})`, [...f.values, bob]));
        await denied(`${f.table}: ownership cannot be transferred`, () => asUser(alice, `update public.${f.table} set user_id = $1 where user_id = $2`, [bob, alice]));
        check(`${f.table}: other user's update affects zero rows`, (await asUser(alice, `update public.${f.table} set ${f.field} = $1 where user_id = $2 returning *`, [f.replacement || 'Changed', bob])).rows.length === 0);
        check(`${f.table}: other user's delete affects zero rows`, (await asUser(alice, `delete from public.${f.table} where user_id = $1 returning *`, [bob])).rows.length === 0);
        const updated = (await asUser(alice, `update public.${f.table} set ${f.field} = $1, created_at = '2000-01-01' where user_id = $2 returning *`, [f.replacement || 'Changed', alice])).rows[0];
        check(`${f.table}: own update works and timestamps are maintained`, updated[f.field] === (f.replacement || 'Changed') && new Date(updated.created_at).getTime() === new Date(initial.created_at).getTime() && new Date(updated.updated_at) >= new Date(initial.updated_at));
        for (const sql of [`select * from public.${f.table}`, insert, `update public.${f.table} set ${f.field} = ${f.field}`, `delete from public.${f.table}`]) {
            await denied(`${f.table}: signed-out ${sql.split(' ')[0]} is denied`, () => asUser(null, sql, sql === insert ? f.values : [], 'anon'));
        }
        await denied(`${f.table}: signed-in TRUNCATE is denied`, () => asUser(alice, `truncate public.${f.table}`));
        check(`${f.table}: missing user claim cannot read rows`, (await asUser(null, `select * from public.${f.table}`)).rows.length === 0);
        await denied(`${f.table}: missing user claim cannot insert`, () => asUser(null, insert, f.values));
        check(`${f.table}: owner can delete their own row`, (await asUser(alice, `delete from public.${f.table} where user_id = $1 returning *`, [alice])).rows.length === 1);
        check(`${f.table}: owner delete leaves the other user intact`, (await asUser(bob, `select * from public.${f.table}`)).rows.length === 1);
        await asUser(alice, insert, f.values);
    }

    check('five-digit stop codes and service suffix case are preserved', (await asUser(alice, 'select bus_stop_code, service_no from public.railpulse_favourite_buses')).rows[0].bus_stop_code === '01012' && (await asUser(alice, 'select service_no from public.railpulse_favourite_buses')).rows[0].service_no === '12e');
    await denied('duplicate bookmarks for one user are prevented', () => asUser(alice, "insert into public.railpulse_saved_routes (name, mode, origin_id, destination_id) values ('Duplicate', 'train-only', 'EW24', 'EW23')"), '23505');
    await denied('bus stop codes cannot lose leading zeroes', () => asUser(alice, "insert into public.railpulse_saved_routes (name, mode, origin_id, destination_id) values ('Bad', 'bus', '1012', '17009')"), '23514');
    await denied('same-origin routes are rejected', () => asUser(alice, "insert into public.railpulse_saved_routes (name, origin_id, destination_id) values ('Bad', 'EW24', 'EW24')"), '23514');
    await denied('empty bookmark names are rejected', () => asUser(alice, "insert into public.railpulse_saved_routes (name, origin_id, destination_id) values (' ', 'EW23', 'EW24')"), '23514');
    await denied('unknown journey modes are rejected', () => asUser(alice, "update public.railpulse_preferences set preferred_mode = 'taxi'"), '23514');
    await denied('unknown travel preferences are rejected', () => asUser(alice, "update public.railpulse_preferences set preference = 'teleport'"), '23514');
    await denied('too-short transfer allowance is rejected', () => asUser(alice, 'update public.railpulse_preferences set transfer_minutes = 3'), '23514');
    await denied('too-long transfer allowance is rejected', () => asUser(alice, 'update public.railpulse_preferences set transfer_minutes = 31'), '23514');
    await denied('invalid bus direction is rejected', () => asUser(alice, 'update public.railpulse_favourite_buses set direction = 3'), '23514');
    await asUser(alice, 'insert into public.railpulse_preferences default values on conflict (user_id) do nothing');
    check('lazy preference creation preserves existing settings', (await asUser(alice, 'select theme from public.railpulse_preferences')).rows[0].theme === 'dark');
    await asUser(alice, "insert into public.railpulse_favourite_buses (service_no, bus_stop_code, label) values ('12e', '01012', 'Renamed') on conflict (user_id, service_no, bus_stop_code) do update set label = excluded.label");
    check('owner can upsert a favourite without duplicates', (await asUser(alice, 'select label from public.railpulse_favourite_buses')).rows[0].label === 'Renamed');

    const insertPlace = (user, place) => {
        const fields = Object.keys(place);
        return asUser(user, `insert into public.railpulse_saved_places (${fields.join(', ')}) values (${fields.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(place));
    };
    const stationPlace = { label: 'Work', category: 'work', location_type: 'station', source_id: 'EW24' };
    await insertPlace(alice, stationPlace);
    await insertPlace(bob, stationPlace);
    check('different users can each save Home and Work', (await asUser(alice, "select category from public.railpulse_saved_places where category in ('home', 'work')")).rows.length === 2 && (await asUser(bob, "select category from public.railpulse_saved_places where category in ('home', 'work')")).rows.length === 2);
    await denied('one Home per user', () => insertPlace(alice, { ...stationPlace, category: 'home' }), '23505');
    await denied('one Work per user', () => insertPlace(alice, stationPlace), '23505');
    await denied('changing another shortcut to Home cannot duplicate it', () => asUser(alice, "update public.railpulse_saved_places set category = 'home' where category = 'work'"), '23505');
    const busPlace = (await insertPlace(alice, { label: 'School bus stop', location_type: 'bus_stop', source_id: '01012' })).rows[0];
    await insertPlace(alice, { ...stationPlace, category: 'other', label: 'Gym' });
    check('multiple custom shortcuts are allowed and bus codes keep leading zeroes', (await asUser(alice, "select * from public.railpulse_saved_places where category = 'other'")).rows.length === 2 && busPlace.source_id === '01012');
    await asUser(alice, "update public.railpulse_saved_places set address = 'Updated synthetic address', latitude = 1.31, longitude = 103.81 where category = 'home'");
    check('Home can be updated without creating another shortcut', (await asUser(alice, "select * from public.railpulse_saved_places where category = 'home'")).rows[0].address === 'Updated synthetic address');

    const badPlaces = [
        ['missing station ID', { ...stationPlace, category: 'other', source_id: null }],
        ['blank label', { ...stationPlace, category: 'other', label: ' ' }],
        ['unknown category', { ...stationPlace, category: 'school' }],
        ['unknown location type', { ...stationPlace, location_type: 'taxi' }],
        ['missing bus stop ID', { label: 'Bad', location_type: 'bus_stop' }],
        ['short bus stop code', { label: 'Bad', location_type: 'bus_stop', source_id: '1012' }],
        ['address without coordinates', { label: 'Bad', location_type: 'address', address: 'Synthetic address' }],
        ['coordinates without address', { label: 'Bad', location_type: 'address', latitude: 1.3, longitude: 103.8 }],
        ['address mixed with source ID', { label: 'Bad', location_type: 'address', address: 'Synthetic address', latitude: 1.3, longitude: 103.8, source_id: 'EW24' }],
        ['incomplete coordinate pair', { ...stationPlace, category: 'other', latitude: 1.3 }],
        ['latitude out of range', { ...stationPlace, category: 'other', latitude: 91, longitude: 103.8 }],
        ['longitude out of range', { ...stationPlace, category: 'other', latitude: 1.3, longitude: 181 }],
        ['NaN latitude', { ...stationPlace, category: 'other', latitude: 'NaN', longitude: 103.8 }]
    ];
    for (const [name, place] of badPlaces) {
        await denied(`saved places reject ${name}`, () => insertPlace(alice, place), '23514');
    }
    await asUser(alice, 'delete from public.railpulse_saved_places where id = $1', [busPlace.id]);
    check('deleting a place preserves saved journeys', (await asUser(alice, 'select * from public.railpulse_saved_routes')).rows.length === 1);

    const aliceCounts = [];
    for (const f of fixtures) aliceCounts.push(await asUser(alice, `select * from public.${f.table}`));
    await db.query('delete from auth.users where id = $1', [bob]);
    for (const [i, f] of fixtures.entries()) {
        const remaining = (await db.query(`select user_id from public.${f.table}`)).rows;
        check(`${f.table}: deleting an Auth user cascades only their data`, remaining.length === aliceCounts[i].rows.length && remaining.every(row => row.user_id === alice));
    }
    await denied('rerunning initial setup fails instead of replacing tables', async () => {
        try { await db.exec(setup); } catch (error) { await db.exec('rollback'); throw error; }
    }, '42P07');
    check('failed rerun preserves existing bookmark data', (await asUser(alice, 'select * from public.railpulse_saved_routes')).rows.length === 1);
    await denied('rerunning add-on fails without replacing saved places', async () => {
        try { await db.exec(upgrade); } catch (error) { await db.exec('rollback'); throw error; }
    }, '42P07');
    check('failed add-on rerun preserves saved places', (await asUser(alice, "select * from public.railpulse_saved_places where category = 'home'")).rows[0].address === 'Updated synthetic address');
    const report = { checkedAt: new Date().toISOString(), installation: useUpgrade ? 'upgrade' : 'fresh', engine: version, checksPassed: checks.length, checks, scope: 'Isolated in-memory PostgreSQL with simulated Auth users/claims; no hosted Supabase project accessed.' };
    fs.writeFileSync(path.join(root, `.cache/supabase-${useUpgrade ? 'upgrade' : 'setup'}-validation.json`), JSON.stringify(report, null, 2));
    console.log(`${report.installation}: ${checks.length} SQL, ownership, grants and constraint checks passed. No remote project was used.`);
    console.log(version);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.close());
