(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.Xiangqi=factory();})(this,function(){
  const W=9,H=10, inside=(r,c)=>r>=0&&r<H&&c>=0&&c<W, at=(r,c)=>r*W+c;
  function pieceSide(p){if(!p)return null;return p===p.toUpperCase()?'red':'black';}
  function createInitialState(){const b=Array(90).fill(null); const put=(r,s)=>s.split('').forEach((p,c)=>{if(p!=='.')b[at(r,c)]=p;});
    put(0,'rnbakabnr');put(2,'.c.....c.');put(3,'p.p.p.p.p');put(6,'P.P.P.P.P');put(7,'.C.....C.');put(9,'RNBAKABNR'); return {board:b,turn:'red'};}
  function inPalace(side,r,c){return c>=3&&c<=5&&(side==='red'?r>=7:r<=2);}
  function rawMoves(state,idx){const p=state.board[idx]; if(!p)return []; const side=pieceSide(p),r=Math.floor(idx/9),c=idx%9, out=[]; const add=(rr,cc)=>{if(!inside(rr,cc))return;const q=state.board[at(rr,cc)];if(pieceSide(q)!==side&&(!q||q.toLowerCase()!=='k'))out.push({from:idx,to:at(rr,cc),piece:p,captured:q||null});};
    const t=p.toLowerCase();
    if(t==='r'||t==='c'){for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){let rr=r+dr,cc=c+dc, jumped=false;while(inside(rr,cc)){const q=state.board[at(rr,cc)];if(!jumped){if(!q)add(rr,cc);else{jumped=true;if(t==='c'){}else {if(pieceSide(q)!==side)out.push({from:idx,to:at(rr,cc),piece:p,captured:q});break;}}}else if(t==='c'&&q){if(pieceSide(q)!==side)out.push({from:idx,to:at(rr,cc),piece:p,captured:q});break;}rr+=dr;cc+=dc;}}}
    else if(t==='n'){for(const [dr,dc,lr,lc] of [[2,1,1,0],[2,-1,1,0],[-2,1,-1,0],[-2,-1,-1,0],[1,2,0,1],[-1,2,0,1],[1,-2,0,-1],[-1,-2,0,-1]])if(!state.board[at(r+lr,c+lc)])add(r+dr,c+dc);}
    else if(t==='b'){for(const [dr,dc] of [[2,2],[2,-2],[-2,2],[-2,-2]]){const rr=r+dr,cc=c+dc;if((side==='red'?rr<5:rr>4)||!inside(rr,cc)||state.board[at(r+dr/2,c+dc/2)])continue;add(rr,cc);}}
    else if(t==='a'){for(const [dr,dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]){const rr=r+dr,cc=c+dc;if(inPalace(side,rr,cc))add(rr,cc);}}
    else if(t==='k'){for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){const rr=r+dr,cc=c+dc;if(inPalace(side,rr,cc))add(rr,cc);} }
    else if(t==='p'){const f=side==='red'?-1:1;add(r+f,c);if((side==='red'?r<=4:r>=5)){add(r,c-1);add(r,c+1);}}
    return out;
  }
  function attacked(state,idx,by){const b=state.board; for(let i=0;i<90;i++)if(pieceSide(b[i])===by){const p=b[i],r=Math.floor(i/9),c=i%9,rr=Math.floor(idx/9),cc=idx%9,t=p.toLowerCase();
      if(t==='p'){const f=by==='red'?-1:1;if((rr===r+f&&cc===c)||( (by==='red'?r<=4:r>=5)&&rr===r&&Math.abs(cc-c)===1))return true;}
      else if(t==='k'&&((rr===r&&Math.abs(cc-c)===1)||(cc===c&&Math.abs(rr-r)===1)))return true;
      else if(t==='k'&&cc===c&&rr!==r){let x=r+Math.sign(rr-r),clear=true;while(x!==rr){if(b[at(x,c)]){clear=false;break;}x+=Math.sign(rr-r);}if(clear)return true;}
      else if(t==='n'&&[[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[-1,2],[1,-2],[-1,-2]].some(([dr,dc])=>rr===r+dr&&cc===c+dc&&!b[at(r+(Math.abs(dr)===2?dr/2:0),c+(Math.abs(dc)===2?dc/2:0))]))return true;
      else if(t==='b'&&Math.abs(rr-r)===2&&Math.abs(cc-c)===2&&((by==='red'?rr>=5:rr<=4))&&!b[at((r+rr)/2,(c+cc)/2)])return true;
      else if((t==='r'||t==='c')&&(rr===r||cc===c)){let n=0,dr=Math.sign(rr-r),dc=Math.sign(cc-c),x=r+dr,y=c+dc;while(x!==rr||y!==cc){if(b[at(x,y)])n++;x+=dr;y+=dc;}if((t==='r'&&n===0)||(t==='c'&&n===1))return true;}
      else if(t==='a'&&Math.abs(rr-r)===1&&Math.abs(cc-c)===1&&inPalace(by,rr,cc))return true;
    } return false;}
  function isInCheck(state,side){const k=side==='red'?'K':'k',i=state.board.indexOf(k);if(i<0)return false;return attacked(state,i,side==='red'?'black':'red');}
  function applyMove(state,m){const b=state.board.slice();b[m.to]=b[m.from];b[m.from]=null;return {board:b,turn:state.turn==='red'?'black':'red'};}
  function movesFrom(state,idx){const p=state.board[idx];if(!p||pieceSide(p)!==state.turn)return [];return rawMoves(state,idx).filter(m=>!isInCheck(applyMove(state,m),state.turn));}
  function generateMoves(state,side){const s=state.turn===side?state:{board:state.board,turn:side};let o=[];for(let i=0;i<90;i++)if(pieceSide(s.board[i])===side)o=o.concat(movesFrom(s,i));return o;}
  function getGameResult(state){const side=state.turn, ms=generateMoves(state,side);if(ms.length)return {over:false,winner:null,reason:null};return {over:true,winner:side==='red'?'black':'red',reason:isInCheck(state,side)?'checkmate':'stalemate'};}
  function countPseudoMoves(state,side){let count=0;for(let i=0;i<90;i++)if(pieceSide(state.board[i])===side)count+=rawMoves(state,i).length;return count;}
  return {createInitialState,pieceSide,movesFrom,generateMoves,applyMove,isInCheck,getGameResult,countPseudoMoves};
});
