const { getDb } = require('../config/database');

class Game {
    static create({ roomId, teamAIds, teamBIds, teamALevel = '2', teamBLevel = '2' }) {
        const result = getDb().prepare(`
            INSERT INTO games (room_id, team_a_ids, team_b_ids, team_a_level, team_b_level)
            VALUES (?, ?, ?, ?, ?)
        `).run(roomId, JSON.stringify(teamAIds), JSON.stringify(teamBIds), teamALevel, teamBLevel);
        return result.lastInsertRowid;
    }

    static findById(id) {
        const game = getDb().prepare('SELECT * FROM games WHERE id = ?').get(id);
        if (game) {
            game.team_a_ids = JSON.parse(game.team_a_ids);
            game.team_b_ids = JSON.parse(game.team_b_ids);
        }
        return game;
    }

    static updateStatus(id, status, extra = {}) {
        const fields = ['status = ?'];
        const values = [status];
        if (extra.winnerTeam !== undefined) { fields.push('winner_team = ?'); values.push(extra.winnerTeam); }
        if (extra.finishedAt) { fields.push('finished_at = CURRENT_TIMESTAMP'); }
        if (extra.teamALevel) { fields.push('team_a_level = ?'); values.push(extra.teamALevel); }
        if (extra.teamBLevel) { fields.push('team_b_level = ?'); values.push(extra.teamBLevel); }
        values.push(id);
        getDb().prepare(`UPDATE games SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    static addParticipant({ gameId, userId, team, ratingBefore }) {
        getDb().prepare(`
            INSERT INTO game_participants (game_id, user_id, team, rating_before)
            VALUES (?, ?, ?, ?)
        `).run(gameId, userId, team, ratingBefore);
    }

    static updateParticipant(gameId, userId, updates) {
        const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = [...Object.values(updates), gameId, userId];
        getDb().prepare(`UPDATE game_participants SET ${fields} WHERE game_id = ? AND user_id = ?`).run(...values);
    }

    static saveRound({ gameId, roundNumber, finishOrder, tributeData, moveSequence, initialHands, teamALevel, teamBLevel }) {
        const result = getDb().prepare(`
            INSERT INTO game_rounds
            (game_id, round_number, finish_order, tribute_data, move_sequence, initial_hands, team_a_level_before, team_b_level_before)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            gameId, roundNumber,
            JSON.stringify(finishOrder),
            tributeData ? JSON.stringify(tributeData) : null,
            JSON.stringify(moveSequence),
            JSON.stringify(initialHands),
            teamALevel, teamBLevel
        );
        return result.lastInsertRowid;
    }

    static finishRound(roundId) {
        getDb().prepare('UPDATE game_rounds SET finished_at = CURRENT_TIMESTAMP WHERE id = ?').run(roundId);
    }

    static getRounds(gameId) {
        return getDb().prepare('SELECT * FROM game_rounds WHERE game_id = ? ORDER BY round_number').all(gameId);
    }

    static getRound(roundId) {
        const round = getDb().prepare('SELECT * FROM game_rounds WHERE id = ?').get(roundId);
        if (round) {
            round.finish_order = JSON.parse(round.finish_order);
            round.move_sequence = JSON.parse(round.move_sequence);
            round.initial_hands = JSON.parse(round.initial_hands);
            if (round.tribute_data) round.tribute_data = JSON.parse(round.tribute_data);
        }
        return round;
    }

    static getUserHistory(userId, limit = 20, offset = 0) {
        return getDb().prepare(`
            SELECT g.id, g.started_at, g.finished_at, g.winner_team,
                   g.team_a_ids, g.team_b_ids, g.team_a_level, g.team_b_level,
                   gp.team, gp.finish_position, gp.rating_delta
            FROM games g
            JOIN game_participants gp ON gp.game_id = g.id AND gp.user_id = ?
            WHERE g.status = 'finished'
            ORDER BY g.started_at DESC
            LIMIT ? OFFSET ?
        `).all(userId, limit, offset);
    }
}

module.exports = Game;
