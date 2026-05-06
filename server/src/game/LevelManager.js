/**
 * LevelManager - 掼蛋等级管理
 *
 * 等级规则：
 * - 每队从2级开始，目标升到A级
 * - 每局结束后，赢家队伍升级
 * - 升级幅度取决于完成顺序：
 *   - 双下（头游+二游同队）：赢家升3级
 *   - 头游+三游（对家）：赢家升2级
 *   - 头游+末游（对家）：赢家升1级
 * - 升到A级后，下一局赢了即获胜
 */

const LEVELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

class LevelManager {
    /**
     * 计算本局结束后的等级变化
     * @param {Array} finishOrder 完成顺序 [userId, ...]
     * @param {Object} teams { teamA: [userId, userId], teamB: [userId, userId] }
     * @param {string} teamALevel 当前A队等级
     * @param {string} teamBLevel 当前B队等级
     * @returns {{ teamALevel, teamBLevel, winnerTeam, levelUp, isGameOver, isDoubleDown }}
     */
    static calculateLevelChange(finishOrder, teams, teamALevel, teamBLevel) {
        const [first, second, third, fourth] = finishOrder;

        const teamASet = new Set(teams.teamA);
        const firstTeam = teamASet.has(first) ? 'A' : 'B';
        const secondTeam = teamASet.has(second) ? 'A' : 'B';

        const winnerTeam = firstTeam;
        const isDoubleDown = firstTeam === secondTeam;

        let levelUp = 0;

        if (isDoubleDown) {
            levelUp = 3;
        } else {
            // 找头游的队友排名（0-indexed）
            const winnerTeamMembers = winnerTeam === 'A' ? teams.teamA : teams.teamB;
            const partner = winnerTeamMembers.find(id => id !== first);
            const partnerRank = finishOrder.indexOf(partner); // 0=头游, 1=二游, 2=三游, 3=末游

            if (partnerRank === 2) levelUp = 2; // 头游+三游
            else if (partnerRank === 3) levelUp = 1; // 头游+末游
            else levelUp = 2; // 默认
        }

        const currentLevel = winnerTeam === 'A' ? teamALevel : teamBLevel;
        const newLevel = advanceLevel(currentLevel, levelUp);

        const newTeamALevel = winnerTeam === 'A' ? newLevel : teamALevel;
        const newTeamBLevel = winnerTeam === 'B' ? newLevel : teamBLevel;

        // 游戏结束条件：当前等级是A且赢了
        const isGameOver = currentLevel === 'A';

        return {
            winnerTeam,
            levelUp,
            teamALevel: newTeamALevel,
            teamBLevel: newTeamBLevel,
            isGameOver,
            isDoubleDown,
        };
    }

    static getLevelIndex(level) {
        return LEVELS.indexOf(level);
    }

    static getLevelDisplay(level) {
        return level;
    }

    static LEVELS() {
        return LEVELS;
    }
}

function advanceLevel(currentLevel, steps) {
    const idx = LEVELS.indexOf(currentLevel);
    if (idx === -1) return currentLevel;
    return LEVELS[Math.min(idx + steps, LEVELS.length - 1)];
}

module.exports = LevelManager;
