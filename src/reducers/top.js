import _ from 'lodash/fp';

import { fetchJson } from 'utils/fetch';

import { getRankings, setRankings } from './ranking';
import { getProfiles, getInitialProfiles, setProfiles } from './profiles';

import { HOST } from 'constants/backend';

const LOADING = `TOP/LOADING`;
const SUCCESS = `TOP/SUCCESS`;
const ERROR = `TOP/ERROR`;
const SET_FILTER = `TOP/SET_FILTER`;
const RESET_FILTER = `TOP/RESET_FILTER`;

export const defaultFilter = { showRank: true, showRankAndNorank: true };

const initialState = {
  isLoading: false,
  data: [],
  filter: defaultFilter,
};

const preprocessData = data =>
  _.flow(
    _.get('top'),
    _.values,
    _.map(item => ({
      song: item.track,
      chartLabel: item.chart_label,
      chartLevel: item.chart_label.slice(1),
      chartType: item.chart_label.slice(0, 1),
      mix: item.mix,
      results: item.results.map((res, index) => {
        const perfects = (Math.sqrt(res.perfects) * _.toInteger(item.chart_label.slice(1))) / 2;
        const acc = perfects
          ? Math.floor(
              ((perfects * 100 + res.greats * 60 + res.goods * 30 + res.misses * -20) /
                (perfects + res.greats + res.goods + res.bads + res.misses)) *
                100
            ) / 100
          : null;
        return {
          playerId: res.player,
          nickname: data.players[res.player].nickname,
          nicknameArcade: data.players[res.player].arcade_name,
          originalChartMix: res.originalChartMix,
          originalChartLabel: res.originalChartLabel,
          originalScore: res.originalScore,
          date: res.gained,
          dateObject: new Date(res.gained),
          grade: res.grade,
          isExactDate: !!res.exact_gain_date,
          score: res.score,
          perfect: res.perfects,
          great: res.greats,
          good: res.goods,
          bad: res.bads,
          miss: res.misses,
          combo: res.max_combo,
          mods: res.mods_list,
          isRank: !!res.rank_mode,
          isHJ: (res.mods_list || '').split(' ').includes('HJ'),
          accuracy: acc < 0 ? 0 : acc === 100 ? acc : acc && acc.toFixed(2),
        };
      }),
    })),
    _.map(song => {
      return {
        ...song,
        latestScoreDate: song.results.reduce(
          (latest, current) => (current.date > latest ? current.date : latest),
          song.results[0].date
        ),
        results: song.results.map(res => ({
          ...res,
          hasRankScore: _.some({ playerId: res.playerId, isRank: true }, song.results),
        })),
      };
    }),
    _.orderBy(['latestScoreDate', 'song', 'chartLevel'], ['desc', 'asc', 'desc'])
  )(data);

export default function reducer(state = initialState, action) {
  switch (action.type) {
    case LOADING:
      return {
        ...state,
        isLoading: true,
      };
    case ERROR:
      return {
        ...state,
        isLoading: false,
        error: action.error,
      };
    case SUCCESS:
      return {
        ...state,
        isLoading: false,
        data: action.data,
        players: action.players,
      };
    case SET_FILTER:
      return {
        ...state,
        filter: action.filter,
      };
    case RESET_FILTER:
      return {
        ...state,
        filter: defaultFilter,
      };
    default:
      return state;
  }
}

export const fetchTopScores = () => {
  return async (dispatch, getState) => {
    dispatch({ type: LOADING });
    try {
      const data = await fetchJson({
        url: `${HOST}/top/v2`,
      });
      // const data = jsonData;
      const processedData = preprocessData(data);
      const initialProfiles = getInitialProfiles(processedData, getState().tracklist);
      const rankings = getRankings(processedData, data, initialProfiles);
      dispatch({
        type: SUCCESS,
        data: processedData,
        players: _.flow(
          _.toPairs,
          _.map(([id, player]) => ({ ...player, id: _.toInteger(id) }))
        )(data.players),
      });
      dispatch(setRankings(rankings));
      const profiles = getProfiles(initialProfiles, processedData, rankings);
      dispatch(setProfiles(profiles));
      return processedData;
    } catch (error) {
      console.log(error);
      dispatch({ type: ERROR, error });
    }
  };
};

export const setFilter = filter => ({
  type: SET_FILTER,
  filter,
});
export const resetFilter = () => ({
  type: RESET_FILTER,
});
