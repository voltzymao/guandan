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
     * @param {number} teamAFailA A队A级失败次数
     * @param {number} teamBFailA B队A级失败次数
     * @returns {{ teamALevel, teamBLevel, winnerTeam, levelUp, isGameOver, isDoubleDown, teamAFailA, teamBFailA, resetToLevel2 }}
     */
    static calculateLevelChange(finishOrder, teams, teamALevel, teamBLevel, teamAFailA = 0, teamBFailA = 0) {
        const [first, second, third, fourth] = finishOrder;

        const teamASet = new Set(teams.teamA);
        const firstTeam = teamASet.has(first) ? 'A' : 'B';
        const secondTeam = teamASet.has(second) ? 'A' : 'B';

        const winnerTeam = firstTeam;
        const isDoubleDown = firstTeam === secondTeam;

        let levelUp = 0;
        let isGameOver = false;
        let failA = winnerTeam === 'A' ? teamAFailA : teamBFailA;
        let resetToLevel2 = false;

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

        // A级特殊处理
        if (currentLevel === 'A') {
            const winnerTeamMembers = winnerTeam === 'A' ? teams.teamA : teams.teamB;
            const partner = winnerTeamMembers.find(id => id !== first);
            const partnerRank = finishOrder.indexOf(partner);

            // 过关条件：头游且对家不是末游（对家是二游或三游）
            if (partnerRank === 1 || partnerRank === 2) {
                isGameOver = true;
            } else {
                // 未过关：对家是末游
                failA++;
                if (failA >= 2) {
                    resetToLevel2 = true;
                    failA = 0;
                }
                levelUp = 0; // A级没过不升级
            }
        }

        let newLevel;
        if (resetToLevel2) {
            newLevel = '2';
        } else {
            newLevel = advanceLevel(currentLevel, levelUp);
        }

        const newTeamALevel = winnerTeam === 'A' ? newLevel : teamALevel;
        const newTeamBLevel = winnerTeam === 'B' ? newLevel : teamBLevel;
        const newTeamAFailA = winnerTeam === 'A' ? failA : teamAFailA;
        const newTeamBFailA = winnerTeam === 'B' ? failA : teamBFailA;

        return {
            winnerTeam,
            levelUp,
            teamALevel: newTeamALevel,
            teamBLevel: newTeamBLevel,
            isGameOver,
            isDoubleDown,
            teamAFailA: newTeamAFailA,
            teamBFailA: newTeamBFailA,
            resetToLevel2,
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
