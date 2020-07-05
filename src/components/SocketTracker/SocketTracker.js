import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { connect } from 'react-redux';
import classNames from 'classnames';
import numeral from 'numeral';
import _ from 'lodash/fp';
import { createSelector } from 'reselect';
import { FaAngleDoubleUp } from 'react-icons/fa';
import lev from 'fast-levenshtein';

import './socket.scss';

import { SOCKET_SERVER_IP } from 'constants/backend';
import Loader from 'components/Shared/Loader';
import Flag from 'components/Shared/Flag';

import { appendNewResults } from 'reducers/results';
import { fetchTopPerSong } from 'reducers/topPerSong';
import { fetchUserPreferences } from 'reducers/preferences';

import { getTimeAgo, useTracked, useResetTrackedObject } from './helpers';

import { PlayerCard, ChartLabel } from './PlayerCard';

// code
const STATE_RESET_TIMEOUT = 10 * 60 * 1000; // 5 minutes

const topPlayersListSelector = createSelector(
  (state) => state.results.profiles,
  _.flow(_.values, _.orderBy('ratingRaw', 'desc'), (items) =>
    items.map((it, index) => ({ place: index + 1, ..._.pick(['id', 'name', 'rating'], it) }))
  )
);

// redux
const mapStateToProps = (state) => {
  return {
    isLoading: state.topPerSong.isLoading,
    songTopData: state.topPerSong.data,
    error: state.topPerSong.error,
    profiles: state.results.profiles,
    topPlayersList: topPlayersListSelector(state),
    sharedCharts: state.results.sharedCharts,
  };
};

const mapDispatchToProps = {
  fetchTopPerSong,
  appendNewResults,
  fetchUserPreferences,
};

function TrackerApp({
  isLoading,
  fetchTopPerSong,
  fetchUserPreferences,
  appendNewResults,
  songTopData,
  error,
  profiles,
  topPlayersList,
  // resultInfo = {},
  sharedCharts = {},
}) {
  // Setup
  const [message, setMessage] = useState('');
  const [socketErrorMessage, setSocketErrorMessage] = useState('');
  const [isSocketReady, setSocketReady] = useState(false);
  const [isAlive, setAlive] = useState(false);
  const [leftLabel, setLeftLabel] = useState(null);
  const [rightLabel, setRightLabel] = useState(null);
  const [leftPlayer, setLeftPlayer] = useState(null);
  const [rightPlayer, setRightPlayer] = useState(null);
  const [recognizedSongName, setRecognizedSongName] = useState('');
  const [leftPreferences, setLeftPreferences] = useState(null);
  const [rightPreferences, setRightPreferences] = useState(null);

  const resultsContainerRef = useRef(null);
  const leftResultRef = useRef(null);
  const rightResultRef = useRef(null);

  const socketRef = useRef(null);
  const timeoutResetTokenRef = useRef(null);

  // Get profile objects from player names
  const leftProfile = useMemo(() => {
    if (!leftPlayer || _.isEmpty(profiles)) return {};
    return _.minBy((p) => lev.get(p.nameArcade, leftPlayer), _.values(profiles)) || {};
  }, [leftPlayer, profiles]);
  const rightProfile = useMemo(() => {
    if (!rightPlayer || _.isEmpty(profiles)) return {};
    return _.minBy((p) => lev.get(p.nameArcade, rightPlayer), _.values(profiles)) || {};
  }, [rightPlayer, profiles]);

  // Track changes in profiles
  const leftTracked = {
    pp: useTracked(_.get('pp.pp', leftProfile), leftProfile.name),
    elo: useTracked(leftProfile.ratingRaw, leftProfile.name),
    exp: useTracked(leftProfile.exp, leftProfile.name),
    expRank: useTracked(leftProfile.expRank, leftProfile.name),
    achievements: useTracked(leftProfile.achievements, leftProfile.name),
  };
  const resetLeftTracked = useResetTrackedObject(leftTracked);
  const rightTracked = {
    pp: useTracked(_.get('pp.pp', rightProfile), rightProfile.name),
    elo: useTracked(rightProfile.ratingRaw, rightProfile.name),
    exp: useTracked(rightProfile.exp, rightProfile.name),
    expRank: useTracked(rightProfile.expRank, rightProfile.name),
    achievements: useTracked(rightProfile.achievements, rightProfile.name),
  };
  const resetRightTracked = useResetTrackedObject(rightTracked);

  // Fetch preferences when player id changes
  useEffect(() => {
    fetchUserPreferences(leftProfile.id).then((response) => {
      setLeftPreferences(response.preferences);
    });
  }, [leftProfile.id, fetchUserPreferences]);
  useEffect(() => {
    fetchUserPreferences(rightProfile.id).then((response) => {
      setRightPreferences(response.preferences);
    });
  }, [rightProfile.id, fetchUserPreferences]);

  // Reset the page when sockets didn't receive any messages for a long time
  const restartTimeout = useCallback(() => {
    setAlive(true);
    if (timeoutResetTokenRef.current) {
      clearTimeout(timeoutResetTokenRef.current);
    }
    timeoutResetTokenRef.current = setTimeout(() => {
      // TODO: reset page
    }, STATE_RESET_TIMEOUT);
  }, []);

  // Start websockets
  useEffect(() => {
    socketRef.current = new WebSocket(SOCKET_SERVER_IP);
    socketRef.current.onerror = () => {
      setMessage(`Cannot connect to websocket server, please reload the page`);
    };
    socketRef.current.onopen = (e) => {
      setSocketReady(true);
    };
  }, []);

  // Set the onmessage callback
  useEffect(() => {
    socketRef.current.onmessage = (event) => {
      restartTimeout();
      try {
        const data = event && event.data && JSON.parse(event.data);
        console.log(data);

        if (data.type === 'result_screen') {
          console.log('Resetting tracking because received result screen');
          resetLeftTracked();
          resetRightTracked();
          const songName = data.data.track_name;
          const leftLabel = _.get('left.chart_label', data.data);
          const rightLabel = _.get('right.chart_label', data.data);
          const leftPlayer = _.get('left.result.player_name', data.data);
          const rightPlayer = _.get('right.result.player_name', data.data);
          setLeftPlayer(leftPlayer);
          setRightPlayer(rightPlayer);
          setLeftLabel(leftLabel);
          setRightLabel(rightLabel);
          setRecognizedSongName(songName);
          appendNewResults(data.data.gained); // Fetch results that we don't have here yet (to calculate elo)
          fetchTopPerSong(songName, leftLabel, rightLabel);
        } else if (data.type === 'chart_selected') {
          setSocketErrorMessage(data.data.error || '');
          if (data.data.leftPlayer || data.data.rightPlayer) {
            setLeftPlayer(data.data.leftPlayer);
            setRightPlayer(data.data.rightPlayer);
          }
          if (data.data.leftLabel || data.data.rightLabel) {
            setLeftLabel(data.data.leftLabel);
            setRightLabel(data.data.rightLabel);
            if (data.data.text) {
              // If we have full info, try to fetch if needed
              const newSongName = data.data.text;
              setRecognizedSongName(newSongName);
              console.log('song name', newSongName, recognizedSongName);
              if (recognizedSongName !== newSongName) {
                fetchTopPerSong(newSongName, data.data.leftLabel, data.data.rightLabel);
              }
            }
          }
        }
      } catch (e) {
        console.log('on message error', e);
        setMessage(`Error: ${e.message}`);
      }
    };
  }, [
    recognizedSongName,
    fetchTopPerSong,
    restartTimeout,
    appendNewResults,
    resetLeftTracked,
    resetRightTracked,
  ]);

  // FOR DEBUG
  // useEffect(() => {
  //   if (!_.isEmpty(profiles) && !leftPlayer && !rightPlayer) {
  //     socketRef.current.onmessage({
  //       data:
  //         '{"type": "chart_selected", "data": {"text": "Uranium", "leftLabel": "D17", "rightLabel": "D20", "leftPlayer": "GRUMD", "rightPlayer": "DINO"}}',
  //     });
  //   }
  // }, [profiles, leftPlayer, rightPlayer]);

  // Resize the results blocks to fill the most space on the page
  useEffect(() => {
    if (resultsContainerRef.current && leftResultRef.current) {
      if (rightResultRef.current) {
        // Both refs
        const left = leftResultRef.current;
        const right = rightResultRef.current;
        const totalSize = {
          w: resultsContainerRef.current.clientWidth,
          h: resultsContainerRef.current.clientHeight,
        };
        const scaleHH = totalSize.w / (left.offsetWidth + right.offsetWidth);
        const scaleHW = totalSize.h / Math.max(left.offsetHeight, right.offsetHeight);
        const scaleWH = totalSize.w / Math.max(left.offsetWidth, right.offsetWidth);
        const scaleWW = totalSize.h / (left.offsetHeight + right.offsetHeight);
        // console.log(scaleHH, scaleHW, scaleWH, scaleWW);
        if (Math.min(scaleHH, scaleHW) > Math.min(scaleWH, scaleWW)) {
          resultsContainerRef.current.style.flexDirection = 'row';
          resultsContainerRef.current.style.alignItems = 'center';
          if (scaleHH > scaleHW) {
            resultsContainerRef.current.style.transform = `scale(${0.98 * scaleHW})`;
          } else {
            resultsContainerRef.current.style.transform = `scale(${0.98 * scaleHH})`;
          }
        } else {
          resultsContainerRef.current.style.flexDirection = 'column';
          resultsContainerRef.current.style.alignItems = 'center';
          if (scaleWH > scaleWW) {
            resultsContainerRef.current.style.transform = `scale(${0.98 * scaleWW})`;
          } else {
            resultsContainerRef.current.style.transform = `scale(${0.98 * scaleWH})`;
          }
        }
      } else {
        // One ref
        const left = leftResultRef.current;
        const totalSize = {
          w: resultsContainerRef.current.clientWidth,
          h: resultsContainerRef.current.clientHeight,
        };
        const scaleW = totalSize.w / left.offsetWidth;
        const scaleH = totalSize.h / left.offsetHeight;
        if (scaleW < scaleH) {
          resultsContainerRef.current.style.transform = `scale(${0.98 * scaleW})`;
        } else {
          resultsContainerRef.current.style.transform = `scale(${0.98 * scaleH})`;
        }
      }
    }
  });

  const leftChart = _.find({ chartLabel: leftLabel }, songTopData);
  const rightChart = _.find({ chartLabel: rightLabel }, songTopData);
  const chartsToShow = _.uniq(_.compact([leftChart, rightChart]));

  return (
    <div className="tracker-container">
      <div className="sidebar">
        <PlayerCard
          player={leftPlayer}
          profile={leftProfile}
          label={leftLabel}
          trackedData={leftTracked}
          preferences={leftPreferences}
          topPlayersList={topPlayersList}
          isLeft
        />
        <PlayerCard
          player={rightPlayer}
          profile={rightProfile}
          label={rightLabel}
          trackedData={rightTracked}
          preferences={rightPreferences}
          topPlayersList={topPlayersList}
        />
      </div>
      <div className="results" ref={resultsContainerRef}>
        {(error || message) && (
          <div className="error">
            {message}
            <br />
            {error && error.message}
          </div>
        )}
        {isSocketReady &&
          !leftPlayer &&
          !rightPlayer &&
          !socketErrorMessage &&
          !isLoading &&
          _.isEmpty(chartsToShow) &&
          (isAlive ? (
            <div className="msg">Waiting for chart select...</div>
          ) : (
            <div className="offline msg">Recognizer is offline</div>
          ))}
        {isSocketReady &&
          (leftLabel || rightLabel) &&
          !socketErrorMessage &&
          !isLoading &&
          _.isEmpty(chartsToShow) &&
          'No results for this chart'}
        {isLoading && <Loader />}
        {!isLoading &&
          chartsToShow.map((chart, chartIndex) => {
            const leftPlayersHiddenStatus = _.getOr({}, 'playersHiddenStatus', leftPreferences);
            const rightPlayersHiddenStatus = _.getOr({}, 'playersHiddenStatus', rightPreferences);

            let topPlace = 1;
            const occuredNicknames = [];
            const results = chart.results
              .filter((res) => {
                const showThisResult =
                  (chart.chartLabel === leftLabel && !leftPlayersHiddenStatus[res.playerId]) ||
                  (chart.chartLabel === rightLabel && !rightPlayersHiddenStatus[res.playerId]);
                return showThisResult;
              })
              .map((res, index) => {
                const isSecondOccurenceInResults = occuredNicknames.includes(res.nickname);
                occuredNicknames.push(res.nickname);
                if (index === 0) {
                  topPlace = 1;
                } else if (
                  !isSecondOccurenceInResults &&
                  res.score !== _.get([index - 1, 'score'], chart.results)
                ) {
                  topPlace += 1;
                }
                return {
                  ...res,
                  topPlace,
                  isSecondOccurenceInResults,
                };
              });

            const interpDiff = _.get('interpolatedDifficulty', sharedCharts[chart.sharedChartId]);
            return (
              <div
                className="song-block"
                key={chart.song + chart.chartLabel}
                ref={chartIndex === 0 ? leftResultRef : rightResultRef}
              >
                <div className="song-name">
                  <ChartLabel type={chart.chartType} level={chart.chartLevel} />
                  <div>
                    {interpDiff ? `(${interpDiff.toFixed(1)}) ` : ''}
                    {chart.song}
                  </div>
                </div>
                <div className="charts">
                  <div className="chart">
                    <div className="results">
                      <table>
                        <tbody>
                          {results.map((res, index) => {
                            let placeDifference, newIndex;
                            if (res.scoreIncrease && res.date === chart.latestScoreDate) {
                              const prevScore = res.score - res.scoreIncrease;
                              newIndex = _.findLastIndex((res) => res.score > prevScore, results);
                              placeDifference = newIndex - index;
                            }
                            // const pp = _.getOr('', `[${res.id}].pp.ppFixed`, resultInfo);
                            const flag = profiles[res.playerId] ? (
                              <Flag region={profiles[res.playerId].region} />
                            ) : null;
                            return (
                              <tr
                                key={res.score + res.nickname}
                                className={classNames({
                                  empty: !res.isExactDate,
                                  latest: res.date === chart.latestScoreDate,
                                  left: res.nickname === leftProfile.name,
                                  right: res.nickname === rightProfile.name,
                                })}
                              >
                                <td className="nickname">
                                  <div className="nickname-container">
                                    {flag}
                                    <span className="nickname-text">
                                      {res.nickname}
                                      {!!placeDifference && (
                                        <span className="change-holder up">
                                          <span>{placeDifference}</span>
                                          <FaAngleDoubleUp />
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                </td>
                                {/* <td className="pp">
                                  {pp}
                                  {pp && <span className="_grey">pp</span>}
                                </td> */}
                                <td
                                  className={classNames('judge', {
                                    vj: res.isRank,
                                    hj: res.isHJ,
                                  })}
                                >
                                  {res.isRank && (
                                    <div className="inner">{res.isExactDate ? 'VJ' : 'VJ?'}</div>
                                  )}
                                  {res.isHJ && <div className="inner">HJ</div>}
                                </td>
                                <td className="score">
                                  <span className="score-span">
                                    {res.scoreIncrease > res.score * 0.8 && '*'}
                                    {numeral(res.score).format('0,0')}
                                  </span>
                                </td>
                                <td className="grade">
                                  <div className="img-holder">
                                    {res.grade && res.grade !== '?' && (
                                      <img
                                        src={`${process.env.PUBLIC_URL}/grades/${res.grade}.png`}
                                        alt={res.grade}
                                      />
                                    )}
                                    {res.grade === '?' && null}
                                  </div>
                                </td>
                                <td className="number miss">{res.miss}</td>
                                <td className="number bad">{res.bad}</td>
                                <td className="number good">{res.good}</td>
                                <td className="number great">{res.great}</td>
                                <td className="number perfect">{res.perfect}</td>
                                <td className="combo">
                                  {res.combo}
                                  {res.combo ? 'x' : ''}
                                </td>
                                <td className="accuracy">
                                  {res.accuracy}
                                  {res.accuracy ? '%' : ''}
                                </td>
                                <td
                                  className={classNames('date', {
                                    latest: res.date === chart.latestScoreDate,
                                  })}
                                >
                                  {getTimeAgo(res.dateObject)}
                                  {res.isExactDate ? '' : '?'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export default connect(mapStateToProps, mapDispatchToProps)(TrackerApp);
